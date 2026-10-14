# keep-alive 原理

keep-alive 是 Vue 内置组件，作用是**缓存组件实例**：切换时保留状态（表单输入、滚动位置）、不销毁实例（setup 不重新执行）、切回时直接复用。

## 作用：与 v-if 对比

| | v-if 切换 | keep-alive 切换 |
|---|---|---|
| 实例 | 销毁（触发 unmounted） | 缓存，不销毁 |
| DOM | 从文档移除 | 移入离屏容器，切回再移回来 |
| 组件状态 | 丢失 | 保留 |
| 切回时 | 重新 setup + mounted | 复用实例，只触发 activated |
| 成本 | 切换开销大（重建） | 常驻内存 |
| 适用 | 确定不再用的组件 | tab 页签、列表页-详情页返回 |

```vue
<!-- v-if：false 时彻底销毁，回来重新构建 -->
<HeavyComp v-if="show" />

<!-- keep-alive：切走只是缓存，回来原样恢复 -->
<KeepAlive>
  <component :is="currentTab" />
</KeepAlive>
```

## 本质：内置抽象组件

KeepAlive 在源码里是一个选项对象定义的组件（`runtime-core/src/components/KeepAlive.ts`）：

```typescript
const KeepAliveImpl = {
  name: 'KeepAlive',
  __isKeepAlive: true,   // 供渲染器识别的特殊标记
  props: { include: [String, RegExp, Array], exclude: [String, RegExp, Array], max: [String, Number] },
  setup(props, { slots }) {
    // ...建立缓存、向渲染器注册 activate/deactivate
    return () => {
      // render：返回第一个子组件的 vnode，自己不产生任何 DOM
    }
  },
}
```

1. **不渲染真实 DOM**：render 直接返回子组件的 vnode，DOM 树里没有 keep-alive 对应的元素。实测挂载后，容器下的唯一子节点就是子组件的根元素，子组件就像直接写在 keep-alive 的父级位置。
2. **对组件链的准确细节**：Vue 2 的 keep-alive 有 `abstract: true` 选项，不出现在 `$parent` 组件链中；Vue 3 里 KeepAlive 实例就是子组件的 `instance.parent`（实测验证），但因为不渲染 DOM，对 DOM 结构完全透明。

它与渲染器的协作：setup 把 `activate` / `deactivate` 两个函数挂到 `instance.ctx` 上，渲染器遇到相应标记就调用它们，避免渲染器直接 import KeepAlive（利于 tree-shaking）。

## 缓存 key：vnode.key + 组件类型

```typescript
// 源码原句
const key = vnode.key == null ? comp : vnode.key
```

| 写法 | 缓存 key |
|---|---|
| `<Comp />`（无 key） | 组件定义对象（`vnode.type`，引用唯一） |
| `<Comp key="a" />` | 字符串 `'a'` |

同一个组件的多个实例（`<Comp key="a" />` 和 `<Comp key="b" />`）会各占一个缓存槽，互不干扰。

## 核心实现（简化源码）

setup 返回的 render 函数，每次渲染执行：

```typescript
return () => {
  const rawVNode = slots.default()[0]   // 取第一个子组件 vnode
  const comp = rawVNode.type
  const name = getComponentName(comp)     // include/exclude 匹配用

  // 1. 不在 include / 命中 exclude → 原样渲染，不缓存
  if ((include && (!name || !matches(include, name))) ||
      (exclude && name && matches(exclude, name))) {
    return rawVNode
  }
  // 2. 计算 key、查缓存
  const key = rawVNode.key == null ? comp : rawVNode.key
  const cachedVNode = cache.get(key)
  if (cachedVNode) {
    // 3. 命中 → 复用缓存的组件实例和 DOM，打"来自缓存"标记
    rawVNode.component = cachedVNode.component
    rawVNode.el = cachedVNode.el
    rawVNode.shapeFlag |= ShapeFlags.COMPONENT_KEPT_ALIVE
    keys.delete(key); keys.add(key)        // LRU：把 key 提到"最近使用"
  } else {
    // 4. 未命中 → 登记 key；超过 max 淘汰最久未使用的
    keys.add(key)
    if (max && keys.size > parseInt(max, 10)) {
      pruneCacheEntry(keys.values().next().value!)   // Set 第一个 = 最久未用
    }
  }
  // 5. 两种情况都要打"应被缓存"标记
  rawVNode.shapeFlag |= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
  return rawVNode
}
```

缓存写入时机：render 时只登记 `pendingCacheKey`，等 KeepAlive 自身 mounted/updated 后，把 `instance.subTree`（真实渲染出的子 vnode）存入 cache。

### 两个 shapeFlag 标记与渲染器的配合

| shapeFlag | 谁读它 | 渲染器行为 |
|---|---|---|
| COMPONENT_KEPT_ALIVE（命中缓存时打） | processComponent | 跳过 mountComponent，改走 **activate**（复用实例） |
| COMPONENT_SHOULD_KEEP_ALIVE（两种情况都打） | unmount | 跳过真实卸载，改走 **deactivate**（缓存起来） |

```typescript
// 渲染器中的两处拦截（简化）
if (n1 == null) {
  if (n2.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
    parentComponent.renderer.activate(n2, container, anchor)   // 激活
  } else {
    mountComponent(n2, container, anchor)                      // 正常挂载
  }
}
// unmount 中
if (vnode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
  parentComponent.renderer.deactivate(vnode)   // 失活
  return                                      // 直接返回，跳过销毁
}
```

### activate / deactivate 做了什么

```typescript
// KeepAlive setup 里注册（简化）
const storageContainer = createElement('div')   // 离屏 div，不挂到文档上

sharedContext.activate = (vnode, container, anchor) => {
  const inst = vnode.component
  move(vnode, container, anchor)      // 缓存的 DOM 从离屏容器移回原位置
  patch(inst.vnode, vnode, ...)      // 切换期间 props 可能变了，补一次更新
  queuePostRenderEffect(() => {
    inst.isDeactivated = false
    inst.a && invokeArrayFns(inst.a)   // 触发 activated 钩子
  })
}
sharedContext.deactivate = (vnode) => {
  const inst = vnode.component
  move(vnode, storageContainer, null)  // DOM 移入离屏容器（不销毁）
  queuePostRenderEffect(() => {
    inst.da && invokeArrayFns(inst.da)  // 触发 deactivated 钩子
    inst.isDeactivated = true
  })
}
```

### A → B → A 全流程

```
渲染 A：未命中缓存
  → 登记 key、正常挂载（setup → mounted → activated）
  → KeepAlive updated 后把 A 的 vnode 存入 cache
切换到 B：
  → 卸载 A 的 vnode：带 SHOULD_KEEP_ALIVE → 拦截成 deactivate
  → A 的 DOM 移入 storageContainer，触发 A 的 deactivated
  → 挂载 B（首次：setup → mounted → activated）
切回 A：
  → render 命中 cache：新 vnode 复用缓存的 component 实例和 el
  → 带 KEPT_ALIVE → 拦截成 activate：DOM 移回原位置，触发 activated
  → 不触发 mounted，setup 不重新执行
```

## LRU 淘汰策略

源码用 `cache: Map`（key → vnode）+ `keys: Set`（维护使用顺序）实现 LRU：

- **命中**：`keys.delete(key); keys.add(key)` —— Set 先删再加，把 key 移到末尾（最近使用）
- **淘汰**：`keys.values().next().value` 取 Set 第一个（最久未使用），删除缓存并**真实 unmount** 组件实例

基于 Map 插入顺序的手写简化版（与源码原理相同）：

```typescript
class LRUCache<T> {
  private cache = new Map<string, T>()
  constructor(private max: number) {}

  get(key: string): T | undefined {
    if (!this.cache.has(key)) return undefined
    const val = this.cache.get(key)!
    this.cache.delete(key)
    this.cache.set(key, val)   // 重新插入 = 移到"最近使用"
    return val
  }

  set(key: string, val: T) {
    this.cache.delete(key)    // 已存在时先删，保证移到末尾
    this.cache.set(key, val)
    if (this.cache.size > this.max) {
      const oldest = this.cache.keys().next().value!   // 最先插入 = 最久未用
      this.cache.delete(oldest)
      // 真实源码：这里会对被淘汰组件的 vnode 执行真实 unmount（释放实例）
    }
  }
}
```

实测 `max=1`：A → B 时 A 被真实 unmounted（触发 unmounted 钩子）；再切回 A 时重新 setup + mounted，如同从未缓存过。max 的意义是限制内存占用，淘汰的是整个组件实例。

## activated / deactivated

| 时机 | 触发 | 不触发 |
|---|---|---|
| 首次进入缓存 | mounted → activated | — |
| 切走（切到其他组件） | deactivated | unmounted |
| 切回 | activated | mounted（setup 也不执行） |
| 缓存被 max 淘汰 | unmounted | — |
| include 变化不再匹配 | unmounted | — |
| KeepAlive 自身卸载 | 当前组件 deactivated，所有缓存 unmounted | — |

实测输出（vue@3.5，A/B 互切）：

```
首次挂载 A:    A setup → A mounted → A activated
切换到 B:      A deactivated；B setup → B mounted → B activated
切回 A:        A activated（没有 setup、没有 mounted）
卸载 KeepAlive: A deactivated；B unmounted；A unmounted
```

```typescript
import { onActivated, onDeactivated } from 'vue'

onActivated(() => { refresh() })        // 每次切入：刷新列表、恢复滚动位置（mounted 只在首次触发）
onDeactivated(() => { stopPolling() })  // 每次切走：清理定时器、暂停轮询（实例还在，unmounted 不会触发）
```

注册机制：onActivated/onDeactivated 内部通过 `registerKeepAliveHook` 把钩子注册到"keep-alive 根实例"（缓存组件树的最外层）统一调度，包装函数会检查 `isDeactivated`，处于失活分支的组件不会误触发。

## include / exclude

按**组件 name** 匹配，支持三种形式：

```typescript
// 源码 matches（简化）
function matches(pattern, name) {
  if (Array.isArray(pattern)) return pattern.some(p => matches(p, name))
  if (typeof pattern === 'string') return pattern.split(',').includes(name)
  if (pattern instanceof RegExp) { pattern.lastIndex = 0; return pattern.test(name) }
  return false
}
```

用法 `:include="['CompA', 'CompB']"`、`:exclude="/^Lazy/"`。注意 `<script setup>` 组件的 name 按文件名推断，include 匹配不到会直接不缓存，需显式声明：

```vue
<script setup>
defineOptions({ name: 'CompA' })
</script>
```

include/exclude 变化时（深度侦听 + post 时机）执行 pruneCache：把不再匹配的缓存条目**真实卸载**；当前正在显示的组件只重置标记，等下次切走时才销毁。

## 面试答法

keep-alive 是 Vue 内置的抽象组件，作用是组件切换时缓存实例：保留状态、切回时不重建。它的 render 函数取第一个子组件 vnode，以 `vnode.key ?? 组件类型` 作为缓存 key 存入 Map。命中缓存时，把缓存的组件实例和 el 复制到新 vnode 上并打上 COMPONENT_KEPT_ALIVE 标记，渲染器看到标记就不走 mountComponent 而是执行 activate——把离屏容器中的 DOM 移回原位并触发 activated；切走时因为 COMPONENT_SHOULD_KEEP_ALIVE 标记，卸载被拦截成 deactivate——DOM 移入一个不挂载到文档的 div 容器并触发 deactivated，实例不销毁。缓存用 LRU 管理：命中会把 key 移到最近使用，max 超限时把最久未使用的实例真实卸载。include/exclude 按组件 name 匹配（字符串、正则、数组），变化时会清理不再匹配的缓存。
