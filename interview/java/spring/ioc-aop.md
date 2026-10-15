# IOC 与 AOP、循环依赖

## 题目

> Spring IOC 的 Bean 生命周期？三级缓存如何解决循环依赖？AOP 的实现时机？

## 核心要点

### Bean 生命周期

```
实例化（构造器）→ 属性填充（依赖注入）→ Aware 回调
→ BeanPostProcessor#before → InitializingBean/init-method → #after（AOP 代理在此生成）
→ 使用 → DisposableBean/destroy-method
```

### 循环依赖（三级缓存）

- `singletonObjects`（成品）→ `earlySingletonObjects`（半成品）→ `singletonFactories`（工厂）
- A 创建时提前把 ObjectFactory 放入三级缓存，B 注入 A 时通过工厂拿到**早期引用**（必要时先套 AOP 代理）
- 构造器注入的循环依赖无法解决（实例化前就需要依赖）

### AOP

- 代理在 Bean 初始化后由 `AnnotationAwareAspectJAutoProxyCreator` 创建
- 切点匹配 → JDK/CGLIB 代理 → 责任链执行通知（Before/Around/After…）

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
