# IOC 与 AOP、循环依赖

## 题目

> Spring IOC 的本质是什么？Bean 的生命周期？三级缓存如何解决循环依赖？为什么需要第三级？

## 为什么需要 IOC（生活化例子）

```
不开 IOC：A 需要 B，A 就自己 new B —— 相当于每辆车出厂时把发动机焊死在车架上，
        B 换个型号，所有用过 B 的 A 全部改代码重新出厂

开 IOC：  所有零件先注册到"装配车间"（容器），声明一句"A 车要装 B 型发动机"即可，
        换发动机只改配置，车架（业务代码）一行不动
```

控制权反转：对象"由谁创建、依赖由谁装配"这件事，从程序员手里交给了容器。

## 核心要点

### IOC 本质图解

```
不用容器：A ──new──► B ──new──► C     依赖硬编码，牵一发动全身

使用容器：
   ┌───────────────── Spring 容器 ─────────────────┐
   │ ① 扫描 @Component → 注册 BeanDefinition（图纸）   │
   │ ② 需要时反射实例化 → 属性注入 → 生命周期回调       │
   └──────────────────────────────────────────────────┘
        ▲ 声明需要 B          ▲ 声明需要 B
   A ───┘（@Autowired）   B ───┘
   A、B 互不相识，只认识容器 → 耦合点从"互相 new"收敛为"都只依赖容器"
```

DI 三种注入方式一句带过：**构造器注入**（官方推荐，依赖不可变）、**Setter 注入**（可选依赖）、**字段注入**（最省事但脱离容器没法单测）。

### Bean 生命周期流程图

```
BeanDefinition（扫描/注册图纸）
   ▼
① 实例化（反射调构造器，得到"毛坯"对象）
   ▼
② 属性填充（@Autowired 依赖注入 —— 循环依赖在这里爆发，也在这里解决）
   ▼
③ Aware 回调（BeanNameAware / BeanFactoryAware / ApplicationContextAware）
   ▼
④ BeanPostProcessor#postProcessBeforeInitialization
   ▼
⑤ 初始化（@PostConstruct → InitializingBean#afterPropertiesSet → init-method）
   ▼
⑥ BeanPostProcessor#postProcessAfterInitialization ◄──【AOP 代理通常在这步生成】
   ▼
⑦ 放进一级缓存 singletonObjects，对外使用
   ▼
⑧ 容器关闭：@PreDestroy → DisposableBean#destroy → destroy-method
```

### 三级缓存

```
一级 singletonObjects      成品：完整走完生命周期的单例
二级 earlySingletonObjects 半成品：提前暴露的早期引用（实例化了，属性没填完）
三级 singletonFactories    工厂：ObjectFactory，被调用时才决定给"原对象"还是"AOP 代理"
```

### A↔B 循环依赖：三级缓存解决时间线

前提：A 依赖 B、B 依赖 A，都是单例 + 字段/Setter 注入。

```
时刻   动作                                             三级缓存变化
t1   getBean(A)：反射实例化 A（毛坯）
t2   A 把【ObjectFactory-A】放三级缓存                  三级:[A工]
t3   A 属性填充 → 发现要 B → 触发 getBean(B)
t4   实例化 B（毛坯），B 把【ObjectFactory-B】放三级缓存   三级:[A工,B工]
t5   B 属性填充 → 发现要 A → getBean(A)（A 还没建完！）
     → 一级没有？二级没有？三级有 A 的工厂
     → 调工厂 getEarlyBeanReference()：
        A 需要 AOP 就"提前"生成代理，否则返回原对象 A
     → 结果放二级，工厂从三级删除                    三级:[B工]  二级:[A早期引用]
t6   B 注入 A 的早期引用 → B 属性填完 → 初始化完成
     → B 进一级缓存，B 的工厂从三级删除               一级:[B]  二级:[A]  三级:[]
t7   回到 A 的属性填充：把成品 B 注入 A → A 填完 → 初始化完成
     → A 进一级缓存（若 t5 已提前代理，这里放的就是同一个代理）
     → 二级里的 A 移除                               一级:[A,B]  二级:[]
```

**关键点**：B 拿到的是 A 的**早期引用**（可能是提前生成的代理），所以 B 能先完成；A 随后走完流程，两边互相持有，闭环成立。

### 为什么需要第三级缓存（而不是两级）

```
如果只有两级（直接存"早期对象"）会陷入两难：
  ① 二级直接放原始对象 → B 拿到的是没代理的 A，破坏 AOP 语义
  ② 一实例化就提前生成代理 → 违背设计：代理本应在初始化后（⑥）生成

第三级放【工厂】= 延迟决策：
  没有循环依赖 → 工厂永远不会被调用，代理照常在初始化后生成
  有循环依赖   → 真有人提前要 A，工厂才临时生成代理
  工厂内部有标记 → 代理只创建一次，后续放一级时复用同一个代理对象
```

### 哪些循环依赖解不了

| 场景 | 一句原因 |
| --- | --- |
| 构造器注入 | 实例化本身就需要依赖，毛坯都造不出来，没有可提前暴露的早期引用 |
| prototype | 容器不缓存 prototype，没有"提前暴露工厂"的机制 |
| 特殊代理场景（如 @Async） | 工厂提前生成的代理类型与最终要求不符，可能直接报错 |

### AOP 与 BeanPostProcessor

- AOP 一句话：**运行时动态代理织入增强**；目标类有接口 → JDK 动态代理，没接口 → CGLIB 子类代理（选择细节见反射/动态代理篇）
- **BeanPostProcessor 是 AOP 与 @Autowired 的共同基础**：
  - `AutowiredAnnotationBeanPostProcessor`：处理 @Autowired，完成属性注入（生命周期的②）
  - `AnnotationAwareAspectJAutoProxyCreator`：本身也是 BeanPostProcessor，在 `postProcessAfterInitialization`（⑥）生成 AOP 代理

## 面试答法

### 30 秒版（可背诵）

> IOC 是控制反转：对象的创建和装配交给容器，业务代码只声明依赖，解耦靠的是大家都依赖容器而不是互相 new。Bean 生命周期是：实例化、属性注入、Aware 回调、初始化前后处理、初始化、放进单例池，销毁时逆序回调，AOP 代理在初始化后的后置处理里生成。循环依赖靠三级缓存解决：A 实例化后先往三级缓存放一个工厂，创建 B 时 B 通过这个工厂拿到 A 的早期引用先完成自己，A 再继续走完流程。之所以第三级放工厂，是为了延迟决定返回原对象还是 AOP 代理，保证代理只创建一次。注意构造器注入和 prototype 的循环依赖解决不了。

### 深入版（被追问时按这条线展开）

1. **IOC 本质**：先讲"自己 new"的耦合问题 → 容器统一创建 + 注入 → 控制权反转
2. **生命周期**：按流程图顺序报菜名，强调 AOP 代理生成在初始化后的后置处理
3. **循环依赖**：拿 A、B 互相注入举例，逐帧讲三级缓存的读写（t1~t7 时间线）
4. **灵魂追问"为什么不是两级"**：延迟决策 + 代理只创建一次
5. **边界**：构造器注入、prototype 解不了，说明"提前暴露"机制不覆盖

### 常见追问

- **三级缓存的 key/value 是什么？** → 都是 beanName；value 依次是成品 Bean、早期引用、ObjectFactory 工厂
- **B 注入的是 A 的代理还是原对象？** → A 被 AOP 切中时，B 拿到的是工厂提前生成的同一个代理；否则是原对象
- **为什么构造器注入解不了？** → 实例化阶段就需要依赖，还没走到"提前暴露工厂"那一步
- **@Lazy 能解构造器循环依赖吗？** → 能，注入的是延迟代理，首次真正调用时目标 Bean 才需要就绪
- **BeanPostProcessor 是干嘛的？** → Bean 初始化前后的扩展点，@Autowired 和 AOP 代理生成全靠它
