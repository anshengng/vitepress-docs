# reactive 与 ref 的区别

## 题目

> Vue3 中 reactive 和 ref 有什么区别？为什么 ref 对基本类型也能实现响应式？

## 核心要点

| 对比项 | reactive | ref |
| --- | --- | --- |
| 支持类型 | 对象/数组/Map/Set | 任意类型 |
| 实现方式 | Proxy 整体代理 | 对值包装 `.value`（对象类型内部转 reactive） |
| 解构 | 会丢失响应性（需 toRefs） | 本身是响应式引用 |
| 模板使用 | 直接访问属性 | 自动解包（顶层 ref） |

- `ref` 存对象时内部调用 `reactive`，存基本类型时通过 `RefImpl` 类的 get/set 访问器触发 track/trigger
- 两者都支持 `shallowRef` / `shallowReactive` 浅层优化

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
