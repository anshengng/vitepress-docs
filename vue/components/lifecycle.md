# Vue3 生命周期

## 核心流程

组件从创建到卸载，本质是「实例初始化 → 首次渲染 → 更新 → 卸载」四个阶段，每个阶段由渲染器在固定时机调用实例上注册的钩子。

| 阶段 | 触发者 | 关键动作 |
|------|--------|---------|
| 初始化 | createComponentInstance | 创建实例对象，初始化 props / attrs / slots / provides / refs |
| 执行 setup | setupStatefulComponent | 调用 setup，处理返回值，applyOptions 注册 Options 钩子 |
| 首次渲染 | setupRenderEffect 中 effect 首跑 | 生成子树并 patch 进容器，触发 beforeMount / mounted |
| 更新 | 依赖变化触发 effect 重跑 | patch 新旧子树，触发 beforeUpdate / updated |
| 卸载 | unmountComponent | 卸载子树、停止 effect，触发 beforeUnmount / unmounted |

完整调用链（简化）：

```text
mountComponent
    ↓
createComponentInstance              创建实例：this 代理、provides 链、钩子容器
    ↓
setupComponent
    ├── initProps / initSlots
    └── setupStatefulComponent
            ├── 调用 setup()                      ← Composition API 入口
            ├── handleSetupResult（setupState 挂到实例）
            └── finishComponentSetup → applyOptions
                    ├── beforeCreate / created     （Options API，已弱化）
                    └── registerLifecycleHook 注册其余钩子
    ↓
setupRenderEffect
    └── ReactiveEffect（componentUpdateFn）
            ├── 首跑：beforeMount → 渲染 → patch → mounted
            └── 后续：beforeUpdate → patch → updated
    ↓ 组件卸载
unmountComponent
    ├── beforeUnmount（同步）
    ├── unmount(subTree) 递归卸载子组件 → 子组件 beforeUnmount / unmounted
    └── unmounted（放 post 队列）
```

## Options API 与 Composition API 钩子对应关系

| Options API | Composition API | 触发时机 |
|-------------|-----------------|---------|
| beforeCreate | 无（由 setup 代替） | 实例初始化后、处理 data / computed 之前 |
| created | 无（由 setup 代替） | 完成 data / computed / methods 初始化之后 |
| beforeMount | onBeforeMount | 首次渲染、patch 之前 |
| mounted | onMounted | 首次渲染完成、子树已插入 DOM 之后 |
| beforeUpdate | onBeforeUpdate | 数据变化、重新 patch 之前 |
| updated | onUpdated | 重新 patch 完成、DOM 已更新之后 |
| beforeUnmount | onBeforeUnmount | 组件卸载前，实例仍可用 |
| unmounted | onUnmounted | 组件卸载后，effect 已停止 |
| activated | onActivated | `<KeepAlive>` 缓存的组件被插入时 |
| deactivated | onDeactivated | `<KeepAlive>` 缓存的组件被移除 / 替换时 |
| errorCaptured | onErrorCaptured | 捕获后代组件抛出的错误 |
| renderTracked | onRenderTracked | 开发环境，渲染依赖被收集 |
| renderTriggered | onRenderTriggered | 开发环境，渲染依赖触发更新 |
| serverPrefetch | onServerPrefetch | SSR，组件渲染前预取数据 |

注意：`beforeCreate` 与 `created` 没有对应的 Composition API 写法，它们的能力被 `setup` 吸收。`setup` 在 `createComponentInstance` 之后、渲染之前执行，既能在响应式数据完全建立前做初始化，又能拿到初始 props 与 setupContext，因此可以理解为其执行时机位于 beforeCreate 与 created 之间，二者在 Composition API 时代基本被弱化。

## 钩子注册机制：injectHook

Composition API 的钩子不是立即执行，而是「注册后由渲染器在对应时机统一调用」。底层由 `createHook` + `injectHook` 完成：

```typescript
// runtime-core/src/apiLifecycle.ts
export const createHook = (lifecycle: LifecycleHooks) => {
  return (hook: Function, target: ComponentInternalInstance | null = currentInstance) => {
    // setup 阶段之外注册的钩子无效（SSR 的 serverPrefetch 例外）
    if (!isInSSRComponentSetup || lifecycle === LifecycleHooks.SERVER_PREFETCH) {
      injectHook(lifecycle, hook, target)
    }
  }
}

// onMounted、onUpdated 等均由 createHook 生成
export const onMounted = createHook(LifecycleHooks.MOUNTED)
export const onUpdated = createHook(LifecycleHooks.UPDATED)
```

```typescript
// runtime-core/src/injectHook（实现要点）
export function injectHook(type, hook, target = currentInstance) {
  if (target) {
    // 每个实例的生命周期字段是一个数组，首次注册时才创建
    const hooks = target[type] || (target[type] = [])
    // 包一层：调用前把 currentInstance 指向该实例，出错走统一错误处理
    const wrappedHook = (...args: unknown[]) => {
      setCurrentInstance(target)
      const res = callWithErrorHandling(hook, target, type, args)
      unsetCurrentInstance()
      return res
    }
    hooks.push(wrappedHook)
    return wrappedHook
  }
}
```

关键点：

1. 钩子存放在实例的对应字段上（`instance.bc`、`instance.bm`、`instance.m`、`instance.u`……），字段名由 `LifecycleHooks` 枚举决定。
2. 同一个钩子可以注册多次，按注册顺序依次执行。
3. 注册动作必须发生在 `setup` 执行期间，因为此时 `currentInstance` 指向该实例；在 `setup` 之外（例如异步回调里）调用 `onMounted` 会拿不到实例并告警。

渲染器在各时机用 `callHook` 取出数组统一执行：

```text
mounted 触发链：
componentUpdateFn（首跑完成 patch）
    ↓
queuePostRenderEffect(instance.m)      ← 入 post 队列，等 DOM 更新后执行
    ↓ flushPostFlushCbs
callHook(instance, 'mounted')          ← 遍历 instance.m 数组逐个调用
```

## 父子组件生命周期执行顺序

### 首次挂载

```text
父 beforeMount
    ↓ 渲染父子树 → 遇到子组件
子 beforeMount
    ↓ 子 patch 完成、插入 DOM
子 mounted
    ↓ 父 patch 收尾
父 mounted
```

即「父 beforeMount → 子 beforeMount → 子 mounted → 父 mounted」。原因：父的渲染过程包含子的渲染，子的 DOM 先就绪；而 `mounted` 走 post 队列，父的队列回调排在后。

### 更新

```text
父 beforeUpdate
    ↓ patch 父子树，子 props 变化
子 beforeUpdate
    ↓ 子 patch 完成
子 updated
    ↓
父 updated
```

### 卸载

```text
父 beforeUnmount
    ↓ 递归卸载子
子 beforeUnmount → 子 unmounted
    ↓
父 unmounted
```

`onMounted` 回调进入 post 队列，会等整棵子树挂载完成后统一 flush，因此父 mounted 晚于子 mounted；而 beforeMount / beforeUpdate 是同步在 patch 前后调用的。

## 为什么 mounted 里能访问 DOM

`mounted` 的执行时机是「effect 首跑内已经完成 `patch(null, subTree, container)`，真实 DOM 已创建并插入容器」，所以此时 `this.$el` 与模板元素都已存在。

```typescript
// componentUpdateFn（简化）
const componentUpdateFn = () => {
  if (!instance.isMounted) {
    // 首跑：挂载分支
    invokeArrayFns(instance.bm)                    // beforeMount：patch 之前同步调用
    let { subTree } = instance
    const prevTree = subTree
    subTree = instance.subTree = renderComponentRoot(instance)
    patch(null, subTree, container, anchor)        // 真实 DOM 在此产生并插入
    queuePostRenderEffect(instance.m, suspense)    // mounted：入 post 队列，不在此时同步执行
    instance.isMounted = true
  } else {
    // 更新分支
    invokeArrayFns(instance.bu)                    // beforeUpdate：patch 之前同步调用
    const nextTree = renderComponentRoot(instance)
    const prevTree = instance.subTree
    instance.subTree = nextTree
    patch(prevTree, nextTree, ...)                 // patch 子树
    queuePostRenderEffect(instance.u, suspense)    // updated：入 post 队列
  }
}
```

两个细节：

1. beforeMount / beforeUpdate 同步调用（`invokeArrayFns`），此时 DOM 还没更新。
2. mounted / updated / unmounted 走 `queuePostRenderEffect`，在 DOM 更新后的 post 队列 flush 时才执行，所以能安全读写 DOM，开启异步渲染（Suspense、Transition）时也能拿到最终结果。

因此 mounted 里可以：访问 `this.$el` 或模板 ref、调用子组件 `expose` 出来的方法、做依赖真实布局的操作（测量宽高、初始化第三方库）。

## 其他钩子补充

| 钩子 | 说明 |
|------|------|
| onActivated / onDeactivated | 仅在 `<KeepAlive>` 内部生效，缓存组件被切走 / 切回时触发 |
| onErrorCaptured | 捕获子孙组件错误，返回 false 可阻止继续向上传播 |
| onRenderTracked / onRenderTriggered | 仅开发环境，用于调试渲染依赖 |
| onServerPrefetch | 仅 SSR，返回 Promise，渲染前 await |

组件卸载时会 `stop` 掉实例的 effect scope，组件内所有 computed、watch、effect 一并停止，这也是 `onUnmounted` 之后不应再更新状态的底层原因。

## 面试答法

Vue3 组件的生命周期可以理解成实例初始化、首次渲染、更新、卸载四个阶段：`createComponentInstance` 建好实例和响应式外壳，`setup` 作为 Composition API 的入口在此期间执行，随后 `setupRenderEffect` 建立渲染 effect，effect 首跑时先同步触发 beforeMount，真正 patch 出 DOM 后再把 mounted 放进 post 队列统一执行，因此 mounted 里能访问到真实 DOM。更新时 effect 重跑，patch 前后分别触发 beforeUpdate 和 updated；卸载时 `unmountComponent` 先调 beforeUnmount，递归卸载子树后再触发 unmounted。所有 Composition API 钩子都是通过 `injectHook` 注册到实例的钩子数组上，由渲染器在对应时机用 `callHook` 统一调用，可注册多次并按注册顺序执行；父子顺序上挂载是父 beforeMount → 子 beforeMount → 子 mounted → 父 mounted，更新与卸载顺序同理。
