# SpringBoot 自动配置原理

## 题目

> SpringBoot 自动配置的原理是什么？@SpringBootApplication 包含什么？starter 是什么机制？让你写一个自定义 starter 怎么做？为什么我定义了 DataSource 它就不自动配了？

## 为什么需要自动配置

Spring 时代：一个 Web 项目要手写十几段 XML / 十几个 `@Bean`（DispatcherServlet、视图解析器、数据源、事务管理器……），"配置地狱"。SpringBoot 的主张：**你只管引依赖，剩下的我按"最常见用法"替你配好；你不满意随时覆盖**——这就是"约定优于配置"。

## 核心要点

### @SpringBootApplication 三合一结构图

```
@SpringBootApplication
 ├─ @SpringBootConfiguration      → 本质就是 @Configuration，声明这是配置类
 ├─ @ComponentScan                → 扫描本包及子包的 @Component/@Service...
 └─ @EnableAutoConfiguration      → ★自动配置的入口★
      └─ @Import(AutoConfigurationImportSelector.class)
           这个 Selector 负责去"收集候选自动配置类"
```

### 自动配置完整流程图

```
SpringApplication.run()
   ↓
① 触发 @EnableAutoConfiguration → AutoConfigurationImportSelector
   ↓
② 读所有 jar 包里的清单文件：
   META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
   （SpringBoot 2.7 以前叫 META-INF/spring.factories 的 EnableAutoConfiguration 键）
   → 拿到 100+ 个候选配置类，如 DataSourceAutoConfiguration、
     WebMvcAutoConfiguration、RedisAutoConfiguration...
   ↓
③ 逐个用 @Conditional 系列条件过滤：
   类路径没这个 jar？→ 跳过。用户已定义同类 Bean？→ 让位。没开开关？→ 跳过。
   ↓
④ 活下来的配置类执行，其中的 @Bean 注册进 IoC 容器
   （@ConditionalOnMissingBean 保证"用户配置优先"）
   ↓
⑤ 启动完成：引了 web 依赖 → Tomcat+DispatcherServlet 已就位；
   引了 mysql+写了 url → DataSource 已就位
```

### @Conditional 条件注解速查表

| 注解 | 满足条件才装配 |
| --- | --- |
| @ConditionalOnClass | 类路径存在指定类（判断 starter 引没引依赖） |
| @ConditionalOnMissingBean | 容器里还没有该 Bean —— **用户自定义优先**的关键 |
| @ConditionalOnProperty | 配置项等于指定值（如 `spring.redis.enabled=true`） |
| @ConditionalOnBean | 容器里已有某 Bean |
| @ConditionalOnWebApplication | 是 Web 应用 |
| @ConditionalOnMissingClass | 类路径不存在指定类 |

### 以 DataSourceAutoConfiguration 为例

```
┌─ 启动 ──────────────────────────────────────────────┐
│ 类路径有 DataSource.class？(引了 jdbc starter)        │
│   ├─ 否 → 整个配置类跳过                              │
│   └─ 是 ↓                                           │
│ 容器里用户自己定义了 DataSource Bean？                 │
│   ├─ 是 → @ConditionalOnMissingBean 不满足 → 自动配置让位 │
│   └─ 否 → 读 spring.datasource.* 配置                 │
│         → 建 HikariDataSource（默认池）注册进容器 ✅    │
└─────────────────────────────────────────────────────┘

代码骨架（简化）：
@Configuration
@ConditionalOnClass({ DataSource.class, EmbeddedDatabaseType.class })
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean        // ← 你定义我就退让
    public DataSource dataSource(DataSourceProperties p) { ... }
}
```

### starter 机制图解

```
starter = 依赖聚合(POM) + 自动配置类(jar 里的 AutoConfiguration + imports 清单)

spring-boot-starter-web 里有什么：
├─ spring-boot-starter            → 基础：自动配置机制、日志
├─ spring-boot-starter-tomcat     → 内嵌 Tomcat
├─ spring-web / spring-webmvc     → DispatcherServlet
└─ spring-boot-autoconfigure 里的 WebMvcAutoConfiguration
   （清单文件登记了它 → 启动时被②读入 → 条件满足 → 配好 MVC）

所以"引入 starter = 依赖 + 配置一起到货"，这就是为什么只加依赖就能跑。
```

### 自定义 starter 三步骨架

```java
// ① 属性类：绑定 hello.name=xxx 配置
@ConfigurationProperties(prefix = "hello")
public class HelloProperties { private String name = "world"; /*get/set*/ }

// ② 自动配置类：条件 + 让位规则
@AutoConfiguration
@EnableConfigurationProperties(HelloProperties.class)
@ConditionalOnClass(HelloService.class)
public class HelloAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean
    public HelloService helloService(HelloProperties p) {
        return new HelloService(p.getName());
    }
}

// ③ 登记清单：src/main/resources/
// META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
// 内容一行：com.xxx.HelloAutoConfiguration
```

命名约定：官方 `spring-boot-starter-xxx`，第三方 `xxx-spring-boot-starter`。

### 约定优于配置一句话收尾

> 自动配置不是魔法：**清单文件告诉 SpringBoot 有哪些候选配置，@Conditional 根据"你引了什么依赖、写了什么配置、自己建没建 Bean"做取舍**——常见情况默认能用，异常情况随时覆盖。

## 面试答法

### 30 秒版（可背诵口语）

> @SpringBootApplication 是三合一：配置类、包扫描，加上 @EnableAutoConfiguration。自动配置的入口就是最后这个注解 Import 的 AutoConfigurationImportSelector——启动时它读取每个 jar 的 META-INF/spring 下的 AutoConfiguration.imports 清单文件（旧版是 spring.factories），拿到一百多个候选配置类，再用 @Conditional 系列条件逐个过滤：类路径没对应依赖就跳过，用户自己定义过同类 Bean 就靠 @ConditionalOnMissingBean 让位，剩下的配置类里的 @Bean 才真正注册进容器。starter 的本质是"依赖聚合加自动配置类"，引了 spring-boot-starter-web，Tomcat 和 MVC 的自动配置类就随 jar 到货、条件满足自动生效。自定义 starter 就三步：属性类、自动配置类、登记清单文件。

### 深入版（被追问时按编号展开）

1. **拆注解**：三合一各管什么，@Import 的 Selector 是入口
2. **清单加载**：imports 文件 vs 2.7 前 spring.factories；为什么不用扫全包找（性能：清单 O(1) 拿候选）
3. **条件过滤**：@Conditional 家族逐个说用途，重点 @ConditionalOnMissingBean 体现"用户优先"
4. **DataSource 实例**：画"有依赖→无自定义→建 Hikari"的决策流；追问"我配了两个数据源怎么办"→ @Primary 或全手动
5. **starter 拆解**：画 starter-web 内容物；说明 starter 本身通常零代码
6. **自定义 starter**：三步骨架 + 命名规范 + @AutoConfiguration(replace spring.factories)
7. **收尾**：约定优于配置——默认能用、随时可覆盖

### 常见追问

- **自动配置类什么时候不生效？** → 条件不满足：缺依赖类、用户已定义 Bean、配置开关关闭；可用 debug=true 看 CONDITIONS EVALUATION REPORT
- **@ComponentScan 能扫到 starter 里的配置类吗？** → 不能，starter 在别的包；靠清单文件+@Import 机制加载，不是靠扫描
- **spring.factories 和 imports 文件区别？** → 2.7 拆出 @AutoConfiguration 注解并改用独立 imports 清单，避免一个文件承载多种 SPI、加载更清晰
- **自动配置和 @Bean 手写冲突谁赢？** → 用户赢：@ConditionalOnMissingBean 让自动配置退位；若你的 Bean 类型和它不同则共存
- **starter 里为什么没有业务代码？** → starter 只做"依赖+配置"胶水，实现放在对应的 xxx-autoconfigure/库本体里
