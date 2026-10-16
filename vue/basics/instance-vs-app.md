# 实例与应用：Vue2 vs Vue3 架构演变

## 问题

Vue2 说"每个组件都是一个 Vue 实例"，Vue3 里组件是"应用实例"吗？

## 结论先行

- **Vue2**：`Vue` 是大一统构造函数，组件是它的子类实例，全局配置挂在 `Vue` 上
- **Vue3**：`Vue` 不再是构造函数，`createApp()` 创建**应用实例**，组件实例是内部创建的普通对象（Proxy 代理），全局配置挂在 `app` 上

## Vue2：组件实例广义上就是 Vue 实例

### 大一统构造函数

```typescript
import Vue from 'vue'

// 根实例：new Vue()
const vm = new Vue({
  render: h => h(App),
}).$mount('#app')

// 全局 API 全挂在 Vue 构造函数上
Vue.use(router)
Vue.component('MyButton', MyButton)
Vue.mixin(myMixin)
Vue.prototype.$http = axios   // 所有组件实例都能访问
```

### 组件是 Vue 子类的实例

```typescript
// Vue.extend 创建"Vue 的子类"
const MyComponent = Vue.extend({
  template: '<div>{{ msg }}</div>',
  data() {
    return { msg: 'hi' }
  },
})

// 组件被使用时：new MyComponent()
// 所以组件实例的原型链：instance → MyComponent.prototype → Vue.prototype
// this.$http、this.$emit 这些能力全部来自 Vue.prototype
```

也就是说，Vue2 里**每个组件实例都是 Vue 家族的一员**（原型链继承），这带来了全局配置污染问题：`Vue.mixin` / `Vue.prototype.xxx` 会影响**所有**组件，页面上有多个 Vue 应用时无法隔离。

## Vue3：Vue 不再是那个大一统构造函数

### createApp 创建应用实例

```typescript
import { createApp } from 'vue'

const app = createApp(App)

// 全局 API 从 Vue 挪到了 app 上
app.use(router)
app.component('MyButton', MyButton)
app.mixin(myMixin)
app.config.globalProperties.$http = axios

app.mount('#app')
```

`createApp` 之间互相隔离：

```typescript
const appA = createApp(AppA)
const appB = createApp(AppB)
appA.use(pluginA)   // 只影响 appA
appB.mount('#app-b') // 只影响 appB
```

### 组件实例：普通对象 + Proxy 代理

Vue3 内部创建组件实例不再是 `new VueComponent()`，而是：

```typescript
// runtime-core: createComponentInstance（简化）
const instance = {
  type: MyComponent,    // 组件定义
  props: {},
  setupState: {},
  ctx: {},
  subTree: null,
  isMounted: false,
  // ...
}

// 开发者拿到的 this 是这个实例的 Proxy 代理
// 访问 this.xxx 时按优先级代理到 setupState → data → props → 全局属性
instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)
```

没有原型链继承，组件实例就是一个**普通对象 + 代理**，能力（`$emit` 等）由代理处理器和工具函数注入。

## 为什么 Vue3 要这样改

| 动机 | 说明 |
|---|---|
| 全局配置污染 | Vue2 的 `Vue.mixin` 影响所有应用；Vue3 每个 app 独立上下文，微前端多应用共存 |
| Tree-shaking | 全局 API 挂在对象上（`app.use`）后，模块间无副作用引用，未用到的代码可被摇掉 |
| TypeScript 友好 | `new Vue()` 的选项式参数难以完整推导；`createApp` + 函数式 API 类型定义清晰 |
| 去除隐式原型链 | Proxy 代理替代原型继承，访问拦截更可控，为 Composition API 铺路 |

## 对比表

| 维度 | Vue2 | Vue3 |
|---|---|---|
| 应用创建 | `new Vue()` 根实例 | `createApp()` 返回应用实例 |
| 全局 API | 挂在 `Vue` 构造函数上 | 挂在 `app` 应用实例上 |
| 组件实例创建 | `new VueComponent()`（子类构造） | `createComponentInstance()` 内部函数 |
| 组件实例类型 | Vue 子类实例，继承 `Vue.prototype` | 普通对象 + Proxy 代理 |
| 组件里的 this | 组件实例本身（原型链取全局能力） | 组件实例的 Proxy 代理（拦截器分发） |
| 多应用隔离 | 弱，全局配置共享 | 每个 app 独立上下文 |

## 总结

Vue2 的"每个组件都是一个 Vue 实例"是通过**原型链继承**实现的——组件是 Vue 子类的实例；Vue3 把这条链拆了：**应用实例（app）管全局配置，组件实例是内部普通对象**，两者职责分离。"Vue 实例"这个 Vue2 时代的核心概念，在 Vue3 里演化成了"应用 + 组件实例"两层模型。
