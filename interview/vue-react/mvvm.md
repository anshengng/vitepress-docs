# MVVM 架构理解

## 为什么需要

MVVM 是 Vue 的立身之本，面试问"理解 MVVM"实际在问：① 你是否知道它解决什么问题（View 与 Model 手工同步的胶水代码）；② 能否讲清和 MVC 的区别（Controller → ViewModel，单向调用 → 双向绑定）；③ 能否落到 Vue 的具体机制（响应式 + 模板编译 = 自动同步）。答不出"双向绑定怎么实现的"只能算背概念。

## 核心要点

### 1. 三个角色

```
Model：数据与业务逻辑（数据获取/存储/校验），不感知 View
View：用户界面（模板 + 样式），只负责展示
ViewModel：桥梁——把 Model 转成 View 需要的形态，
           把 View 的交互回写 Model；维护视图状态
```

### 2. MVC vs MVVM 对比

```
MVC（手动同步）：                 MVVM（自动同步）：
  View ──事件──► Controller        View ◄──数据绑定──► ViewModel
  Controller ──改──► Model            ViewModel ◄──── Model
  Controller ──【手动更新】──► View
  问题：View 和 Model 的同步        数据一变 View 自动刷新，
  代码散落在 Controller             View 交互自动回写 Model
```

| 维度 | MVC | MVVM |
| --- | --- | --- |
| 中间角色 | Controller（处理逻辑与跳转） | ViewModel（数据↔视图双向绑定） |
| View↔Model 通信 | 经 Controller **手动**更新 | **自动**同步（绑定系统） |
| View 是否可独立测试 | 难（常混入 DOM 操作） | 易（View 薄，逻辑在 VM 用数据测试） |
| 典型代表 | 后端 Web 框架（Spring MVC） | Vue、Knockout、WPF |
| 复杂度来源 | Controller 变"上帝对象" | 绑定系统本身复杂（框架替你做了） |

### 3. Vue 中的对应关系

| MVVM | Vue 对应物 |
| --- | --- |
| Model | data / 接口返回的业务数据（后端 Model 是 DB 实体，前端一般指数据层） |
| View | template 模板 + CSS（最终渲染的 DOM） |
| ViewModel | **Vue 实例本身**：响应式数据 + computed + methods + 指令系统 |
| 双向绑定 | 响应式系统（Vue2 `Object.defineProperty`，Vue3 `Proxy`）+ 模板编译 + 发布订阅驱动更新 |

```
Vue 的双向同步闭环：

  模板编译：把 {{msg}}、v-model、v-on 编译成 render 函数（建立绑定）
        │
  数据变化：setter / Proxy.set 拦截 ──► 通知依赖收集到的 watcher
        │
  视图更新：重新执行 render ──► diff ──► patch DOM
        │
  用户交互：v-model 的 input 事件 ──► 写回 data ──► 循环成立
```

### 4. 一个 v-model 看懂 MVVM

```html
<!-- View 层：声明式绑定，开发者不再写"取 DOM 值→赋值数据"或反之 -->
<input v-model="text" />
<p>{{ text }}</p>
```

```javascript
// ViewModel（Vue 实例）：text 变化自动同步 <p>，输入自动回写 text
data() { return { text: '' } }
```

## 面试答法

### 30 秒版本（可直接背诵）

> MVVM 是 Model-View-ViewModel：Model 管数据，View 管界面，ViewModel 是两者之间的桥梁。它和 MVC 的核心区别是：MVC 里 Controller 要手动把 Model 的变化更新到 View；MVVM 通过**双向数据绑定**让 View 和 Model 自动同步——数据变了视图自动刷新，视图交互自动回写数据，开发者基本不碰 DOM。在 Vue 里，View 就是模板，Model 是 data 里的业务数据，ViewModel 是 Vue 实例本身，靠响应式系统（Vue2 defineProperty、Vue3 Proxy）做数据劫持，配合模板编译和依赖收集，把"同步"这件事自动化了。好处是 UI 逻辑和业务逻辑分离，View 变薄、可测试性提高。

### 深入展开

1. **先讲动机**：jQuery 时代手动 `$('#x').val()` 取值、`$('#x').text(v)` 赋值，同步代码满天飞 → ViewModel 把同步自动化
2. **画 MVC/MVVM 两张流向图**：Controller 手动更新 vs ViewModel 双向绑定
3. **落到 Vue**：View=模板，Model=data，ViewModel=Vue 实例；v-model 是最直观的双向绑定例子
4. **机制层**：响应式拦截（getter 依赖收集 / setter 派发更新）+ 编译生成 render + 异步队列 patch，说明"自动"不是魔法
5. **边界与代价**：MVVM 不是标准，各框架实现有差异（React 严格说是单向数据流 + 手动 setState，不算典型 MVVM）；绑定系统复杂度被封装进框架，换来业务代码简单

### 常见追问

- **Vue 是严格的 MVVM 吗？** → 大致对应但非教科书：Vue 官方也承认 View 和 ViewModel 之间没有通用双向绑定 API，更多是"响应式 + 单向渲染"；v-model 才提供显式双向语法糖
- **双向绑定的底层实现？** → 数据劫持（defineProperty/Proxy 拦截读写）+ 依赖收集（渲染 effect 记录用了哪些 key）+ 发布订阅（setter 触发对应 effect 重新渲染）
- **MVC 的 Controller 和 MVVM 的 ViewModel 区别？** → Controller 处理输入、决定"改哪个 Model、渲染哪个 View"，是命令式；ViewModel 持有面向视图的状态，绑定让同步自动发生，是声明式
- **MVVM 有什么缺点？** → 小项目引入绑定系统反而增复杂度；调试时"数据怎么变的"链路较长（靠 Devtools 缓解）；大规模双向绑定容易状态流向混乱（所以 React 选单向）
