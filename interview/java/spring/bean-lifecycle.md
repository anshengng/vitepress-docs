# Spring Bean 生命周期（完整深挖版）

## 题目

> 讲一下 Spring Bean 的完整生命周期？每个阶段分别是谁在干活、我们能在哪里介入？@Autowired 和 AOP 代理分别发生在哪一步？

## 为什么需要生命周期（一句话）

`new` 出来的对象 ≠ 能用的对象：依赖没注入、资源没初始化、代理还没包上。Spring 把"从图纸到成品再到回收"拆成**固定的流水线阶段**，并在关键位置留出扩展口，让我们能在"正确的时机"干"正确的事"——这也是面试官想听的"体系感"。

## 核心要点

### 四阶段总览

```
  ① 实例化            ② 属性填充            ③ 初始化                ④ 销毁
 （造毛坯）          （装零件）            （质检开机上岗）        （退场回收）
 构造器跑完     →    @Autowired       →    Aware/BPP/init       →   容器关闭时
 得到空壳对象        依赖全部就位          对象完全可用            逆序回调
 ──────────────────────────────────────────────────────────────────────
 "对象存在"          "对象有血有肉"        "对象能干活"            "对象谢幕"
```

### 完整流程图：每一步谁在干活

```
BeanDefinition（图纸：扫描 @Component / @Bean 得到，只存类信息+属性，还不是对象）
   ▼
① 实例化 Instantiation
   执行者：容器反射调用构造器 → 产出"毛坯"（字段全是默认值，@Autowired 的还是 null）
   ▼
② 属性填充 Populate
   执行者：AutowiredAnnotationBeanPostProcessor 扫出 @Autowired/@Value 的注入点，
          容器递归 getBean 依赖并填进去
   （A↔B 循环依赖在这一步爆发并靠三级缓存化解，时间线详见 IOC 篇）
   ▼
③ Aware 回调（让 Bean 认识"管理层"，逐个检测实现了哪个接口）
   BeanNameAware           → 拿到自己的 beanName
   BeanFactoryAware        → 拿到容器引用
   ApplicationContextAware → 拿到上下文引用（业务里拿上下文最常用的入口）
   ▼
④ BeanPostProcessor#postProcessBeforeInitialization（初始化【前】钩子）
   ▼
⑤ 初始化 Initialization（固定顺序三连，只执行一次）
   @PostConstruct → InitializingBean#afterPropertiesSet → init-method
   ▼
⑥ BeanPostProcessor#postProcessAfterInitialization（初始化【后】钩子）
   ★ AOP 代理在这里诞生：AbstractAutoProxyCreator 判断切点是否命中，
     命中 → 生成代理"偷梁换柱"，之后放进容器的就是这个代理
   ▼
⑦ 成品放入单例池 singletonObjects，整个应用运行期对外提供服务
   ▼
⑧ 容器关闭（shutdown hook 触发）
   @PreDestroy → DisposableBean#destroy → destroy-method（与初始化三连同序）
```

### 每个阶段：谁在干活、能干什么

| 阶段 | 谁在干活 | 我们能干什么 / 注意什么 |
| --- | --- | --- |
| ① 实例化 | 容器（反射调构造器） | 构造器里**别用** @Autowired 字段（还是 null） |
| ② 属性填充 | AutowiredAnnotationBeanPostProcessor | 这之后字段才可用 |
| ③ Aware | 容器检测 Aware 接口 | 拿 beanName / 容器引用，少写静态工具类 |
| ④ BPP-Before | 各 BeanPostProcessor | 通用前处理钩子（业务上较少直接用） |
| ⑤ 初始化 | 容器按序回调 | @PostConstruct 里做资源加载、缓存预热（依赖已就位，安全） |
| ⑥ BPP-After | AbstractAutoProxyCreator 等 | AOP 代理生成点；自定义 BPP 也大多挂这 |
| ⑧ 销毁 | 容器 close | @PreDestroy 释放连接池/线程池，别再调用其他 Bean |

### 关键洞察：@Autowired 和 AOP 全是 BPP 介入的

Spring 没有为 @Autowired、AOP 写死任何逻辑——它们只是**插在流水线上的"编外工人"**（都实现了 BeanPostProcessor）：

```
 流水线：──实例化──►──属性填充──►──Aware──►──BPP-Before──►──初始化──►──BPP-After──►──成品──►
                        ▲                                          ▲
                        │                                          │
  AutowiredAnnotationBeanPostProcessor              AbstractAutoProxyCreator（AOP）
    └─ 盯【属性填充】：扫 @Autowired → 注入依赖          └─ 盯【BPP-After】：切点匹配 → 生成代理

  CommonAnnotationBeanPostProcessor
    └─ 盯【初始化前后】：识别并回调 @PostConstruct / @PreDestroy
```

这就是"扩展点驱动"：容器只搭台，功能靠 BPP 唱戏。没了这些 BPP，@Autowired 就是个普通注解，AOP 无从谈起。

### 实例化 vs 初始化：最容易混的一对

```java
@Component
public class OrderService {
    @Autowired
    private PayService pay;      // ② 属性填充时才注入

    public OrderService() ...    // ① 实例化：跑构造器
        // ⚠ 此刻 pay == null，构造器里调 pay 直接 NPE
        // 依赖在构造期就要用？→ 改构造器注入，容器会先备好依赖再调构造器

    @PostConstruct
    public void warmUp() ...     // ⑤ 初始化：pay 已就位，可安全使用
}
```

一句话：**实例化 = 造出壳子（new）；初始化 = 壳子就绪可上岗（依赖注入完 + init 回调跑完）**。

### 作用域对生命周期的影响

| 作用域 | 何时创建 | 何时销毁 | 一句话备注 |
| --- | --- | --- | --- |
| singleton（默认） | 容器 refresh 末尾预创建；`@Lazy` 则推迟到首次 getBean | 容器关闭时统一执行销毁回调 | 一个容器一份 |
| prototype | **每次** getBean 都新建 | **不执行**销毁回调，客户端自理 | 容器只管生不管死 |
| request / session | 进入对应 Web 范围时创建 | 范围结束时销毁 | Web 环境专用 |

## 面试答法

### 30 秒版（可背诵）

> Bean 生命周期分四阶段：实例化、属性填充、初始化、销毁。实例化是反射调构造器造出毛坯；属性填充由 AutowiredAnnotationBeanPostProcessor 完成 @Autowired 注入；然后 Aware 回调、BPP 前处理、@PostConstruct、afterPropertiesSet、init-method、BPP 后处理——AOP 代理就是在 BPP 后处理这步生成的；最后放进单例池。容器关闭时按 @PreDestroy、destroy、destroy-method 销毁。核心理解是：@Autowired 和 AOP 都不是容器原生功能，而是通过 BeanPostProcessor 插在流水线上的扩展点。

### 深入版（按这条线展开）

1. **先给四阶段框架**，再逐步下钻细节
2. **报菜名时标注执行者**：属性填充 = AutowiredAnnotationBPP，代理生成 = AbstractAutoProxyCreator（after 阶段）
3. **抛出洞察**：容器只搭台、BPP 唱戏，体现对扩展点体系的理解
4. **主动提实例化 ≠ 初始化**：构造器里 @Autowired 字段是 null，答出这个细节直接加分
5. **收尾作用域差异**：prototype 不执行销毁回调，singleton 可被 @Lazy 推迟创建

### 常见追问

- **Bean 什么时候被代理？** → 初始化完成后的 postProcessAfterInitialization 阶段，由 AbstractAutoProxyCreator 判定切点命中后生成。所以同类内 this 调用走的是原始对象、绕过了代理——这正是 @Transactional 失效的头号场景（详见事务失效篇）
- **@PostConstruct 什么时候执行、执行几次？** → 属性填充之后、afterPropertiesSet 之前，只执行一次；此时所有 @Autowired 依赖已就位
- **三个初始化回调的顺序？为什么？** → @PostConstruct → afterPropertiesSet → init-method；注解优先于接口、接口优先于配置
- **销毁顺序和优雅停机？** → kill -15 触发 JVM shutdown hook → 容器 close → 销毁回调执行（连接池、线程池安全收尾）；kill -9 什么都来不及执行，所以优雅停机要靠 SIGTERM
- **构造器里怎么拿到依赖？** → 改构造器注入，容器会先解析依赖再调构造器（也天然规避循环依赖）
