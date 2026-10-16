# BeanFactory vs ApplicationContext 与容器启动流程

## 题目

> BeanFactory 和 ApplicationContext 有什么区别？ApplicationContext 启动时做了什么？refresh() 流程讲一下？BeanFactoryPostProcessor 和 BeanPostProcessor 怎么区分？

## 为什么需要两套容器（一句话）

BeanFactory 是"最小可用 IOC"：只管图纸注册 + 按需 getBean，能跑，但一切都是手动挡。
ApplicationContext 是"自动挡全家桶"：在 IOC 之上叠加事件、国际化、资源加载、自动注册 BPP、启动即预创建单例——日常开发 100% 用它。

## 核心要点

### 容器体系继承图

```
                BeanFactory（顶层接口：getBean —— 最基本的 IOC 容器）
                     ▲
        ┌────────────┴─────────────┐
HierarchicalBeanFactory      ListableBeanFactory
 （可设父子容器）            （可按类型批量列举 Bean）
        ▲                          ▲
        └────────────┬─────────────┘
              ApplicationContext（= BeanFactory 全部能力 + 企业级能力）
                     ▲
     ┌───────────────┼────────────────┐
ClassPathXmlAC   AnnotationConfigAC   WebApplicationContext
（XML 时代）      （注解时代主力）      （Web 环境）
```

### 能力对比表

| 能力 | BeanFactory | ApplicationContext |
| --- | --- | --- |
| getBean / 依赖注入 | ✅ | ✅ |
| Bean 创建时机 | 懒加载：首次 getBean 才创建 | refresh 末尾预实例化全部单例 |
| BeanPostProcessor | 手动 addBeanPostProcessor | 自动检测并注册所有 BPP |
| BeanFactoryPostProcessor | 手动调用 | 自动执行 |
| 事件发布 / 监听 | ❌ | ✅ publishEvent |
| 国际化 MessageSource | ❌ | ✅ |
| 统一资源加载 Resource | ❌ | ✅ |

### 核心区别图解：懒加载 vs 预实例化

```
BeanFactory（懒）：
  启动 ──► 只注册图纸（BeanDefinition），一个 Bean 都不建，启动飞快
  运行中第一次 getBean("orderService")
        └─► 现场创建：实例化→注入→初始化（此时才发现依赖配错 → 上线后才炸）

ApplicationContext（饿）：
  启动 ──► refresh() ──► finishBeanFactoryInitialization
        └─► 批量创建全部非 lazy 单例：错误在【启动期】暴露 + 运行期无首次访问毛刺
```

用几百毫秒的启动时间，换"启动成功 = 依赖装配基本无恙"的确定性。

### refresh() 12 步流程图（★ = 高频考点）

```
AbstractApplicationContext.refresh()
 ① prepareRefresh                 记启动时间、置活跃标志
 ② obtainFreshBeanFactory         刷新并拿到内部 BeanFactory
 ③ prepareBeanFactory             配置标准上下文（ClassLoader、系统 BPP 等）
 ④ postProcessBeanFactory         子类钩子（预留扩展）
 ⑤ ★invokeBeanFactoryPostProcessors    ← BFPP 主场
 │    ConfigurationClassPostProcessor 在这解析 @Configuration/@ComponentScan/@Bean/@Import，
 │    把扫到的类注册成 BeanDefinition（图纸进厂）—— Boot 自动配置也在这触发
 ⑥ ★registerBeanPostProcessors    ← BPP 进场
 │    实例化并注册所有 BeanPostProcessor（@Autowired、AOP 的工人就位待命）
 ⑦ initMessageSource              国际化初始化
 ⑧ ★initApplicationEventMulticaster  ← 建"事件电台"
 ⑨ onRefresh                      子类钩子
 │    Boot 的 ServletWebServerApplicationContext 在这启动【内嵌 Tomcat】
 ⑩ registerListeners              把事件监听器挂上电台
 ⑪ ★finishBeanFactoryInitialization  ← 预创建所有非 lazy 单例
 │    逐个 getBean：完整走一遍生命周期流水线（实例化→注入→初始化，详见 Bean 生命周期篇）
 ⑫ finishRefresh                  发布 ContextRefreshedEvent —— "容器就绪"
```

记法：**前 4 步备环境，⑤ 改图纸，⑥ 请工人，⑦⑧⑩ 建配套（国际化/事件），⑨ 起服务器，⑪ 量产 Bean，⑫ 广播就绪**。

### 两大扩展点对比（BFPP vs BPP，必考）

| 对比 | BeanFactoryPostProcessor | BeanPostProcessor |
| --- | --- | --- |
| 介入时机 | refresh ⑤：图纸就绪后、**任何 Bean 实例化之前** | 每个 Bean 的初始化前后（生命周期④⑥） |
| 操作对象 | BeanDefinition（类定义 / 图纸） | Bean 实例（产品） |
| 执行次数 | 容器启动执行一次 | 每个 Bean 各走一遍 |
| 真实用途 | 占位符解析（PropertySourcesPlaceholderConfigurer）、@Configuration 解析、@ComponentScan 扫描 | @Autowired 注入、AOP 代理生成、@PostConstruct 回调 |

一句话：**BFPP 改图纸，BPP 改产品**——图纸改完了才开始量产，所以 BFPP 天然先于所有 BPP 对 Bean 生效。

### 事件机制图

```
业务代码 publishEvent(new OrderCreatedEvent(this))
   ▼
ApplicationEventMulticaster（refresh ⑧ 建好的"电台"）
   ▼ 按事件类型找出所有匹配的监听器
   ├──► @EventListener 标注的方法（同步，就在发布线程里执行）
   └──► ApplicationListener 接口实现类

常用内置事件：
  ContextRefreshedEvent → refresh ⑫ 发布，容器就绪（常用来做启动后预热）
  ContextClosedEvent    → 容器关闭、销毁回调【之前】发布
```

### SpringBoot 与 refresh 的关系（一句）

`SpringApplication.run` 的核心就是：推断应用类型 → `new` 一个对应的 ApplicationContext（注解配置主力是 AnnotationConfigApplicationContext 及其 Web 变体）→ 把主类注册进去 → 调 `refresh()`；自动配置的魔法发生在 refresh ⑤（详见 Boot 自动配置篇）。

## 面试答法

### 30 秒版（可背诵）

> BeanFactory 是最基础的 IOC 容器，只提供 getBean 和依赖注入，懒加载，Bean 在第一次获取时才创建；ApplicationContext 在它之上加了事件发布、国际化、资源加载、自动注册 BeanPostProcessor，并且启动时预实例化所有单例，错误能提前暴露。它启动的核心是 refresh 十二步：前面准备 BeanFactory，第五步执行 BeanFactoryPostProcessor 完成配置类解析和组件扫描，第六步注册 BeanPostProcessor，中间初始化国际化和事件广播器，Boot 的内嵌 Tomcat 在 onRefresh 启动，第十一步预创建全部单例 Bean，最后发布 ContextRefreshedEvent。两个扩展点的区别一句话：BFPP 在实例化前改 BeanDefinition，BPP 在每个 Bean 初始化前后改实例。

### 深入版（按这条线展开）

1. **先答体系**：继承图一句话带过，落到"基础 IOC vs 全家桶"
2. **答核心区别**：懒加载 vs 预实例化 + 自动注册 BPP
3. **refresh 十二步**：报菜名 + 重点讲 ⑤⑥⑨⑪⑫ 五步"谁在干什么"
4. **抛 BFPP/BPP 对比**："改图纸 vs 改产品"一句话点题
5. **勾连 Boot**：run → new Context → refresh，闭环到自动配置篇

### 常见追问

- **refresh 哪几步最重要？** → ⑤（BFPP：扫描图纸）、⑥（BPP 注册）、⑪（预创建单例）是主干；Boot 应用还要记得 ⑨（内嵌容器在 onRefresh 启动）
- **BFPP 能拿到 Bean 实例吗？** → 不能也不该——它只在图纸阶段运行；真要提前拿 Bean 得小心破坏生命周期
- **BeanFactory 现在还有人直接用吗？** → 有，DefaultListableBeanFactory 是 ApplicationContext 内部真正干活的实现，所有上下文内部都包着一个它
- **事件监听是同步还是异步？** → 默认同步（在发布线程执行）；要异步给监听器配 @Async 或指定线程池
- **ContextRefreshedEvent 会发几次？** → 每次 refresh 发一次；单 Boot 应用通常一次，父子容器场景要注意可能触发多次
