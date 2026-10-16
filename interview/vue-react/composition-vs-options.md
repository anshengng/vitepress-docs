# Vue3 组合式 API vs 选项式 API

## 题目

> Vue3 为什么主推组合式 API？和选项式 API 有什么区别？你们项目里怎么选？

## 为什么需要

选项式 API 按**选项类型**分格放代码：data 放数据、methods 放方法、computed 放计算属性。组件一小很顺手，组件一大，一个功能的代码就被切到四五个抽屉里，读代码得来回开抽屉。

```
需求：一个"搜索列表"功能 = 关键字 + 输入监听 + 请求 + 列表数据

选项式：一个功能 → 散落 4 处
┌──────────────────────────────────────────────┐
│ data:       keyword: '', list: []    ← 功能① │
│ methods:    onInput(), doSearch()    ← 功能① │
│ computed:    filteredList()          ← 功能① │
│ watch:       keyword()               ← 功能① │
│                                              │
│  （①的每一行之间都隔着功能②③④的代码）          │
└──────────────────────────────────────────────┘
                ↓ 逻辑分散，追一根线要上下翻屏
```

组合式 API 把**同一个功能的代码聚合到一起**，还能抽成 useXxx 复用——和 React Hooks 解决的是同一个问题。

## 核心要点

### 一、同一需求两种写法并排对比

需求：表单（用户名 + 密码提交）+ 列表（拉取 + 关键字过滤）。

```js
// ── 选项式：按选项分格，表单和列表的代码混在同一格 ──
export default {
  data() {
    return {
      username: '', password: '',      // 表单的
      keyword: '', list: [],            // 列表的
    }
  },
  computed: {
    filteredList() { /* 列表的 */ },
  },
  methods: {
    submitForm() { /* 表单的 */ },
    async fetchList() { /* 列表的 */ },
  },
  mounted() { this.fetchList() },       // 列表的
}
```

```js
// ── 组合式：按功能聚合，一块一块清清楚楚 ──
// 表单功能（可直接抽成 useUserForm）
const username = ref('')
const password = ref('')
const submitForm = () => { /* ... */ }

// 列表功能（可直接抽成 useUserList）
const keyword = ref('')
const list = ref([])
const filteredList = computed(() => list.value.filter(/* ... */))
const fetchList = async () => { /* ... */ }
onMounted(fetchList)
```

抽离后组件只剩"组装"，复用像搭积木：

```js
function useUserForm() { /* 表单全部逻辑 */ return { username, password, submitForm } }
function useUserList()  { /* 列表全部逻辑 */ return { keyword, list, filteredList } }

setup() {
  return { ...useUserForm(), ...useUserList() }
}
```

### 二、逻辑组织对比图

```
选项式（按选项纵向切）               组合式（按功能横向聚）
┌───────────────┐                  ┌─────────────────────────┐
│ data          │ ═══╗             │ ┌─功能A─────────────┐ │
│ methods       │ ═══╣             │ │ 状态+方法+监听+计算 │ │
│ computed      │ ═══╣              │ ├─功能B─────────────┤ │
│ watch         │ ═══╣             │ │ 状态+方法+监听+计算 │ │
│ 生命周期       │ ═══╝             │ └───────────────────┘ │
└───────────────┘                  └─────────────────────────┘
功能A = 从每个抽屉各抽一根线           功能A = 连续的一整块
组件越大越像毛线球 🔥                随时整块搬走复用 ✅
```

### 三、this 的消失与 setup 的位置

```
选项式：this.username、this.submitForm()
        └─ this 指向组件实例代理：
           TS 下类型推导弱、方法一解构 this 就丢

组合式：<script setup> 顶层直接用变量名
        └─ 没有实例代理这一层：
           天然对 TS 友好，编辑器全程类型提示
```

`<script setup>` 是 setup() 的语法糖：顶层声明的变量和函数自动暴露给模板，不用再 return 一大坨对象。

### 四、响应式 API 选择（一句带过）

`ref` 万能但要 `.value`；`reactive` 只能包对象、解构会丢响应式——详见专篇《ref 与 reactive》。

### 五、组合式的代价（诚实对比）

| 对比项 | 选项式 | 组合式 |
| --- | --- | --- |
| 小组件开发速度 | ✅ 快，结构固定 | 一般，样板代码多 |
| 大组件可读性 | ❌ 逻辑分散 | ✅ 按功能聚合 |
| 逻辑复用 | mixin（来源不明、命名冲突） | ✅ useXxx 显式清晰 |
| TS 支持 | 一般（this 类型绕） | ✅ 全程类型推导 |
| 心智负担 | 低：选项就那几个 | 高：要管 ref/reactive 选择、响应式细节 |
| 学习曲线 | 平缓 | 稍陡（闭包、.value、依赖追踪） |

mixin 的坑（组合式替换它的理由）：

```
mixins: [mixinA, mixinB]
├─ A、B 都定义 loadData → 静默覆盖，出 bug 难查 ❌
├─ 模板用 this.formatDate → 不知道来自哪个 mixin ❌
└─ 组合式：const { formatDate } = useDate() 来源清清楚楚 ✅
```

## 面试答法

### 30 秒版（可背诵）

> 两套 API 底层能力一样，差别在代码组织方式。选项式按 data、methods、computed 分格放，小组件很顺手，但组件一大，同一个功能的代码就散在四五处，复用还得靠 mixin，来源不明还容易命名冲突。组合式改成按功能聚合，相关逻辑写成一块还能抽成 useXxx 复用，配合 script setup 没有 this，TS 类型推导全程在线。代价是心智负担高一点，要自己管 ref、reactive 的选择。所以不是二选一：小而简单的组件用选项式很快，中大型项目、逻辑复杂或要抽复用逻辑就用组合式，新项目我会默认组合式。

### 深入版（被追问时按编号展开）

1. **先给结论**：不是替代关系，是组织方式的演进，底层响应式系统是同一套
2. **画对比图**：选项式"一个功能散 4 处" vs 组合式"一块聚合"，用搜索列表举例
3. **复用升级**：mixin 的命名冲突、来源不明 → useXxx 显式引入，对比代码
4. **this 消失**：TS 推导与解构友好的加分点，带出 script setup 语法糖
5. **诚实讲代价**：心智负担、.value 样板代码，最后落到选型话术收尾

### 常见追问

- **setup 里能用 this 吗？** → 不能也不需要；实在要拿实例用 getCurrentInstance()，但那是逃生舱不推荐
- **mixin 和组合式怎么选？** → 新代码一律组合式；mixin 只在维护老项目时才会遇到
- **选项式会被废弃吗？** → 官方明确长期支持，只是逻辑复用这类新能力只围绕组合式做
- **ref 总要写 .value 很烦怎么办？** → 依赖编辑器插件提示；Vue 官方也有响应式语法糖提案（如 $ref）在实验中
