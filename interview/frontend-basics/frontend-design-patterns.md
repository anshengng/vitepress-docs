# 前端高频设计模式

## 题目

> 前端最常用的设计模式有哪些？单例、工厂、策略、观察者、发布订阅、代理、装饰器、迭代器分别解决什么问题？观察者模式和发布订阅模式的区别是什么？能手写一个事件总线吗？Vue2 的 Dep/Watcher 和 Vue3 的 reactive 分别对应哪个模式？策略模式怎么用来重构一长串 if-else？

## 为什么需要

设计模式不是"二十三种名词"，前端面试真正会问的是**你能不能用模式语言描述你写过的代码**。每个高频模式都对应一个日常痛点：

- 弹窗被到处 new 出多个实例 → 单例
- 组件创建逻辑散落各处 → 工厂
- 校验/计费里 80 行 if-else → 策略
- 状态一变多处要更新 → 观察者 / 发布订阅（框架的响应式本质就是它）
- 想拦截属性的读写 → 代理（Vue3 响应式的底座）
- 日志、节流、权限这类"横切"逻辑到处复制 → 装饰器
- 让自定义对象能被 for...of 遍历 → 迭代器

一句话：**框架源码是模式的教科书，业务代码是模式的练兵场。**

## 核心要点

### 1. 单例模式 —— 全局只许一个实例

**一句话定义**：保证一个类/模块全局只有一个实例，并提供统一访问入口。

```javascript
// 弹窗管理器：全应用共享一个实例，弹窗按队列依次显示
const ModalManager = (() => {
  let instance = null

  function create() {
    const queue = []          // 排队等待显示的弹窗
    let current = null        // 当前正在显示的弹窗
    return {
      open(modal) {
        if (current) queue.push(modal)          // 已有弹窗在显示 → 排队
        else { current = modal; modal.show() }
      },
      close() {
        if (current) current.hide()
        current = queue.shift() || null          // 弹出队列里的下一个
        if (current) current.show()
      }
    }
  }

  return {
    getInstance() {
      if (!instance) instance = create()         // 惰性创建，只创建一次
      return instance
    }
  }
})()

// 任何模块里拿到的都是同一个对象
ModalManager.getInstance().open(loginModal)
```

**业务/框架对应**：全局弹窗管理、埋点上报器、axios 实例封装、Redux/Vuex/Pinia 的 store（模块天然单例）、`window` 上的全局服务。

### 2. 工厂模式 —— 把 new 的脏活集中到一个函数

**一句话定义**：用一个函数封装对象的创建过程，调用方只描述"要什么"，不关心"怎么造"。

```javascript
// 按类型创建弹窗，调用方不需要知道每个弹窗组件的构造细节
function createDialog(type, options = {}) {
  const registry = {
    confirm: ConfirmDialog,
    alert: AlertDialog,
    form: FormDialog
  }
  const Comp = registry[type]
  if (!Comp) throw new Error(`未知弹窗类型: ${type}`)
  // 统一挂载、统一返回 Promise，调用方 await 结果即可
  return mountDialog(Comp, options)   // 内部完成 createElement/渲染/销毁
}

const ok = await createDialog('confirm', { title: '删除', content: '确认删除？' })
```

**业务/框架对应**：站内已有完整实现见 [createDialog 专篇](/vue/dialogs/create-dialog)（命令式创建 + Promise 化关闭）；框架层面 `React.createElement`、Vue 的 `h` 函数、`defineComponent` 都是工厂。

### 3. 策略模式 —— 用"规则表"替代 if-else 长链

**一句话定义**：把每个可变逻辑封装成独立的"策略"，运行时按名字查表选用，新增策略不改主流程（开闭原则）。

重构前——校验函数里塞满 if-else，加一条规则就要改函数体：

```javascript
function validate(values, schema) {
  for (const [field, rules] of Object.entries(schema)) {
    for (const rule of rules) {
      if (rule === 'required') {
        if (!values[field]) return `${field} 为必填项`
      } else if (rule === 'email') {
        if (!/^[^@]+@[^@]+$/.test(values[field])) return `${field} 邮箱格式不正确`
      } else if (rule.startsWith('min:')) {
        const n = Number(rule.split(':')[1])
        if (String(values[field] ?? '').length < n) return `${field} 长度不能少于 ${n}`
      }
      // 新规则 → 继续往上堆 else if……
    }
  }
  return ''
}
```

重构后——校验逻辑全部进策略表，主流程只负责"查表调用"：

```javascript
// 策略表：规则名 -> 校验器，每个策略只做一件事
const strategies = {
  required: (v, field) => (v === undefined || v === '' || v === null ? `${field} 为必填项` : ''),
  email: (v, field) => (/^[^@]+@[^@]+$/.test(String(v)) ? '' : `${field} 邮箱格式不正确`),
  min: (v, field, n) => (String(v ?? '').length < Number(n) ? `${field} 长度不能少于 ${n}` : ''),
  max: (v, field, n) => (String(v ?? '').length > Number(n) ? `${field} 长度不能超过 ${n}` : '')
}

function validate(values, schema) {
  for (const [field, rules] of Object.entries(schema)) {
    for (const rule of rules) {
      const [name, arg] = String(rule).split(':')
      const check = strategies[name]
      if (!check) throw new Error(`没有该校验策略: ${name}`)
      const msg = check(values[field], field, arg)
      if (msg) return msg
    }
  }
  return ''
}

// 新增规则 = 往 strategies 里加一个函数，主流程一行不动
strategies.mobile = (v, field) => (/^1[3-9]\d{9}$/.test(String(v)) ? '' : `${field} 手机号不正确`)
```

**业务/框架对应**：Element Plus / antd 表单的 `rules` 校验器就是策略表；支付方式切换（微信/支付宝/余额）、折扣计算（满减/直减/会员价）、路由守卫按角色选权限策略，都是它的战场。

### 4. 观察者 vs 发布订阅 —— 响应式的两种"通知"姿势

**一句话辨析**：
- **观察者**：订阅者**直接挂在目标身上**，目标状态一变，逐个调用订阅者的 `update`——双方互相认识。
- **发布订阅**：中间隔一个**事件总线**，发布者只喊事件名，订阅者只监听事件名——双方互不认识。

```
观察者（直接耦合）：                    发布订阅（总线解耦）：
                                       发布者 ──► ┐        ┌── 订阅者A
 目标(Subject) ◄──直接引用── 订阅者1    发布者 ──► │事件总线│ ──► 订阅者B
 目标(Subject) ◄──直接引用── 订阅者2    发布者 ──► ┘        └── 订阅者C
 目标变化 → 挨个调订阅者.update()       双方只认识"事件名"，不认识彼此
```

手写观察者（Vue2 的 Dep/Watcher 骨架）：

```javascript
// 目标：持有订阅者列表，变化时挨个通知
class Dep {
  constructor() { this.subs = [] }
  depend(watcher) { this.subs.push(watcher) }          // 订阅：把自己挂上目标
  notify() { this.subs.forEach(w => w.update()) }      // 目标变化 → 直接推给订阅者
}

// 订阅者：实现 update，被目标直接调用
class Watcher {
  constructor(label, fn) { this.label = label; this.fn = fn }
  update() { this.fn(this.label) }
}

const dep = new Dep()
dep.depend(new Watcher('视图A 重新渲染', msg => console.log(msg)))
dep.depend(new Watcher('视图B 重新渲染', msg => console.log(msg)))
dep.notify()   // 两条订阅都收到推送
```

手写发布订阅（EventEmitter / 事件总线）：

```javascript
class EventEmitter {
  constructor() { this.events = Object.create(null) }
  on(type, cb) {
    (this.events[type] ||= []).push(cb)
    return this
  }
  off(type, cb) {
    if (!this.events[type]) return this
    if (cb) this.events[type] = this.events[type].filter(f => f !== cb)
    else delete this.events[type]
    return this
  }
  once(type, cb) {
    const wrapper = (...args) => { this.off(type, wrapper); cb(...args) }
    return this.on(type, wrapper)
  }
  emit(type, ...args) {
    ;(this.events[type] || []).slice().forEach(cb => cb(...args))
    return this
  }
}

const bus = new EventEmitter()
bus.on('login', user => console.log('埋点记录', user))
bus.on('login', () => console.log('刷新菜单'))
bus.emit('login', { name: 'tom' })   // 发布者不知道谁在听
```

对比表：

| 维度 | 观察者 | 发布订阅 |
| --- | --- | --- |
| 结构 | 目标 ↔ 订阅者，直连 | 发布者 ↔ **事件中心** ↔ 订阅者 |
| 是否互相认识 | 目标持有订阅者引用，认识 | 双方只认识事件名，互不认识 |
| 耦合度 | 较高（订阅者要实现目标约定的接口） | 低 |
| 出处 | GoF 23 种设计模式之一 | 非 GoF，源自消息系统，前端常用 |
| 前端对应 | Vue2 的 `Dep`→`Watcher`、Vue3 的 `effect` 订阅、RxJS、`useSyncExternalStore` | Node 的 `EventEmitter`、Vue 的 `$on/$emit`、mitt、`addEventListener` |

**业务/框架对应**：Vue2 里 `Dep`（目标）和 `Watcher`（订阅者）直连是教科书级观察者；Vuex 的 `subscribe`、Pinia 的 `$subscribe`、组件间通信的 mitt 总线是发布订阅。

### 5. 代理模式 —— 在读写前后插一脚

**一句话定义**：不直接操作目标对象，而是操作一个"中间人"，由中间人拦截并增强对目标的访问。

```javascript
// Vue3 reactive 的极简骨架：get 收集依赖，set 触发更新
function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)                                   // 依赖收集：谁在读这个属性
      const res = Reflect.get(t, key, receiver)
      return typeof res === 'object' && res !== null ? reactive(res) : res  // 深层代理
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)                                 // 派发更新：通知所有订阅者
      return ok
    },
    deleteProperty(t, key) {
      const ok = Reflect.deleteProperty(t, key)
      trigger(t, key)
      return ok
    }
  })
}
```

完整原理（track/trigger 如何与 `effect` 配合）见站内 [响应式原理专篇](/vue/reactivity/reactivity)。

**业务/框架对应**：Vue3 `reactive`/`ref` 的底层；`with` 场景——Vue3 模板编译产物用 `with (_ctx)` 把变量解析代理到渲染上下文；此外还有数据校验代理、权限代理（写入前检查角色）、i18n 兜底（取不到的 key 返回默认文案）、接口 mock。

### 6. 装饰器模式 —— 不改函数体，给它"包一层"

**一句话定义**：在不修改原函数/类代码的前提下，在外面包一层逻辑，注入横切关注点（日志、缓存、节流、权限）。

```javascript
// 方法装饰器（TS 实验性 @ 语法）：在 fetchUser 前后自动加日志
function log(target, key, descriptor) {
  const original = descriptor.value
  descriptor.value = function (...args) {
    console.log(`[log] ${key} 被调用`, args)
    const res = original.apply(this, args)
    console.log(`[log] ${key} 返回`, res)
    return res
  }
  return descriptor
}

class ApiService {
  @log                                  // 业务代码零改动，日志能力"贴"上去
  fetchUser(id) { return request(`/user/${id}`) }
}
```

没有 TS 装饰器时，同样思想的手写版就是高阶函数：`const throttledScroll = throttle(onScroll, 300)`（见站内[防抖与节流](/interview/frontend-basics/debounce-throttle)）——`throttle` 本质就是一个"运行时装饰器"。

**业务/框架对应**：MobX 的 `@observable/@action`、NestJS 的 `@Injectable/@Controller`、Vue class-component 的 `@Component`；日常业务里的 `@log/@debounce/@requireAuth` 方法装饰器，以及 Redux 中间件、React HOC（`withRouter`）都是装饰器思想的变体。

### 7. 迭代器模式 —— 统一"逐个取下一个"的协议

**一句话定义**：给对象定义 `Symbol.iterator` 方法，返回一个带 `next()` 的游标，让任何数据结构都能被 `for...of`、展开运算符、解构统一遍历。

```javascript
// 让自定义对象可迭代：range 从 from 遍历到 to
const range = {
  from: 1,
  to: 5,
  [Symbol.iterator]() {
    let cur = this.from
    const end = this.to
    return {
      next() {
        return cur <= end
          ? { value: cur++, done: false }
          : { value: undefined, done: true }
      }
    }
  }
}

for (const n of range) console.log(n)   // 1 2 3 4 5
const arr = [...range]                   // 展开运算符同样走迭代协议
```

**业务/框架对应**：数组、Map、Set、字符串原生可迭代；`NodeList`、`arguments` 靠 `Array.from` 转迭代；Generator 函数天然就是迭代器工厂（手写 `promise-async` 系列题里的 `co` 库就是靠迭代器驱动 generator）；虚拟列表按页产出数据、树形结构深度优先遍历，都可以实现迭代器协议让调用方无感。

## 面试答法

### 30 秒版本

前端最常用的是五个：**策略**（表单校验规则表、支付/折扣按类型查表，替代 if-else）、**发布订阅/观察者**（组件通信的 mitt、`addEventListener` 是发布订阅；Vue2 的 Dep/Watcher、Vue3 的 effect 订阅是观察者，框架响应式的本质就是"依赖收集 + 派发更新"）、**单例**（全局弹窗管理器、store）、**工厂**（`createDialog`、`createElement`）、**代理**（Vue3 的 `reactive` 就是 Proxy）。装饰器和迭代器是加分项：装饰器对应 `@log/@throttle` 这类横切逻辑和 MobX/NestJS，迭代器就是 `Symbol.iterator` 让自定义对象能 `for...of`。

### 深入展开

回答"项目里怎么用的"，按模式 → 场景 → 收益三段讲：

1. **策略 + 表单校验**（最易讲出成果）："校验逻辑原来是 switch，我改成策略表后，新增规则只需注册一个函数，校验主流程不再改动，规则还能跨页面复用。"
2. **发布订阅 + 组件通信**："跨层级组件通信用 mitt 事件总线，组件挂载时 `on`、卸载时 `off`，避免层层透传 props；注意忘记 `off` 会造成内存泄漏和重复监听。"
3. **观察者 → 框架响应式**："Vue2 用 `Object.defineProperty` 给属性装 setter，setter 里通知挂在 Dep 上的 Watcher——这是观察者；Vue3 换成 Proxy，`get` 时 track、`set` 时 trigger，本质仍是观察者，但能拦截新增/删除属性。"
4. **单例 + 弹窗管理**："全局弹窗队列保证同一时刻只有一个模态，其余排队，避免多个 confirm 叠在一起。"
5. **代理 / 装饰器 / 工厂** 各备一个业务例子（mock 数据、`@log` 埋点、`createDialog`）。

### 常见追问 Q/A

- **观察者和发布订阅到底差在哪？** → 差一个"中间人"：观察者里目标直接持有订阅者引用并调它的 `update`；发布订阅里双方只通过事件总线按事件名通信，互不认识。Vue2 Dep/Watcher 是前者，EventEmitter/mitt 是后者。
- **为什么常说 Vue 响应式是观察者而不是发布订阅？** → `Dep` 内部维护 `subs` 数组、变化时逐个调 `watcher.update()`，订阅者直接挂在目标上，没有独立的事件中心；而 `$emit`/bus 有显式的"事件名"中介。
- **策略模式重构 if-else 的收益是什么？** → 开闭原则（加策略不改主流程）、每个策略可独立单测、规则可跨模块复用、可按运行时条件动态换整套策略。
- **发布订阅在浏览器里有什么坑？** → 全局总线是隐式依赖，事件名满天飞难追踪；组件卸载必须 `off`，否则内存泄漏 + 重复回调；大型项目建议优先用状态管理库而不是裸总线。
- **装饰器和 HOC、中间件是什么关系？** → 同一个"包一层"思想的不同语法载体：TS 装饰器包类/方法，React HOC 包组件，Redux 中间件包 `dispatch`。
- **`for...of` 和 `forEach` 遍历有什么区别？** → `for...of` 走 `Symbol.iterator` 协议，任何实现该协议的对象都能遍历，且可用 `break` 中断；`forEach` 只是数组的方法，不能中断。
- **单例模式怎么保证"全局唯一"？** → 把实例藏在闭包/模块作用域的私有变量里，只暴露 `getInstance`；ES Module 天然单例——同一模块多次 import 拿到的是同一份导出。
