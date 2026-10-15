# 反射与动态代理

## 题目

> 反射的原理和性能问题？动态代理有哪两种实现，区别是什么？

## 核心要点

### 反射

- 运行时获取 Class 对象 → 访问字段/方法/构造器（`Class.forName`、`newInstance`）
- 性能损耗：查方法表、参数装箱、访问检查；可用 `setAccessible(true)` 关闭检查
- 应用：Spring IOC 实例化 Bean、MyBatis 结果映射、注解解析

### 动态代理两种方式

| 对比 | JDK Proxy | CGLIB |
| --- | --- | --- |
| 原理 | 接口 + InvocationHandler | 生成目标类的子类，MethodInterceptor |
| 要求 | 目标必须实现接口 | 类不能是 final |
| 使用 | MyBatis、RPC 框架 | Spring AOP 默认（无接口时） |

- Spring AOP 选择规则：有接口默认 JDK（Boot 2.x 起默认 CGLIB），无接口用 CGLIB

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
