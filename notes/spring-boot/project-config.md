# Spring Boot 工程与配置

以陶瓷行业后端 `cihua_backinterface`（Spring Boot 2.5.5 + Java 11，多模块 Maven）为底料，整理工程划分、依赖管理、配置文件组织、配置绑定与 Docker 部署的实际做法，同时补充通用要点，可直接复用到同类项目。

## 多模块划分

项目共 5 个模块，依赖关系自底向上：

```
enum          纯枚举/常量，只依赖 lombok
  ↑
common        基础设施：统一响应、异常、工具类、通用配置，
  ↑           以及几乎全部第三方依赖（web/mybatis-plus/redis/jwt…）
  ├── service        业务逻辑层（Mapper、Service、DTO）
  └── coding-tool    代码生成器（本地跑 main 方法用，不随生产包发布）
  ↑
web-gateway   启动类 + Controller + Web 配置（Security/CORS/拦截器），
              唯一打可执行 jar 的模块（finalName=app）
```

划分思路：

- **谁依赖谁**：上层模块只依赖下层，`web-gateway` 只直接依赖 `service`，`service` 只依赖 `common`，传递依赖自动带出 `enum`。
- **依赖集中在 common**：所有第三方 starter 都声明在 `common`，上层模块不再重复引依赖，避免版本散落在各处。
- **coding-tool 独立**：MyBatis-Plus 代码生成器（`CustomGenerator.main` 直连数据库生成 Entity/Mapper/Service/Controller 到 service 模块），只依赖 `common`，不被生产链路引用，相当于"工程内的脚手架脚本"。

### 版本统一管理

根 pom 继承 `spring-boot-starter-parent`，用 `packaging=pom` 聚合模块，内部模块间依赖版本全部收口到 `dependencyManagement`：

```xml
<!-- 根 pom.xml（节选） -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.5.5</version>
</parent>

<groupId>com.fc.ceramics</groupId>
<artifactId>parent</artifactId>
<version>0.0.1-SNAPSHOT</version>
<packaging>pom</packaging>

<modules>
    <module>enum</module>
    <module>common</module>
    <module>service</module>
    <module>web-gateway</module>
    <module>coding-tool</module>
</modules>

<properties>
    <maven.compiler.source>11</maven.compiler.source>
    <maven.compiler.target>11</maven.compiler.target>
    <ceramics-version>0.0.1-SNAPSHOT</ceramics-version>
</properties>

<dependencyManagement>
    <dependencies>
        <!-- 内部模块只在这里定版本，子模块引用时不写 version -->
        <dependency>
            <groupId>com.fc.ceramics</groupId>
            <artifactId>common</artifactId>
            <version>${ceramics-version}</version>
        </dependency>
        <!-- service、enum 同理 -->
    </dependencies>
</dependencyManagement>
```

子模块引用内部依赖时只写坐标不写版本：

```xml
<!-- web-gateway/pom.xml（节选） -->
<dependency>
    <groupId>com.fc.ceramics</groupId>
    <artifactId>service</artifactId>
</dependency>
```

::: tip 改进点
该项目第三方库版本大多写死在 `common/pom.xml` 里。更彻底的做法是把第三方版本也上收到根 pom 的 `dependencyManagement` + `properties`，子模块一律不带 version，升级时只改一处。
:::

## 常用 starter 依赖速查

以下均为项目 `common/pom.xml` 中实际使用的依赖：

| 场景 | 依赖 | 项目版本 |
| --- | --- | --- |
| Web/MVC | `spring-boot-starter-web` | 2.5.5（parent 管理） |
| 参数校验 | `spring-boot-starter-validation` | parent 管理 |
| 安全认证 | `spring-boot-starter-security` | parent 管理 |
| Redis | `spring-boot-starter-data-redis` | 2.7.3 |
| JPA | `spring-boot-starter-data-jpa` | parent 管理 |
| 模板引擎 | `spring-boot-starter-thymeleaf` | parent 管理 |
| 测试 | `spring-boot-starter-test` | parent 管理 |
| ORM | `mybatis-plus-boot-starter` | 3.4.3.2 |
| 连表查询 | `mybatis-plus-join-boot-starter` | 1.4.9 |
| 分页 | `pagehelper-spring-boot-starter` | 1.4.6 |
| 接口文档 | `knife4j-spring-boot-starter` | 2.0.7 |
| JWT | `jjwt-api` / `jjwt-impl` / `jjwt-jackson` | 0.10.7 |
| 工具库 | `hutool-all` | 5.7.14 |
| 简化代码 | `lombok`（`optional=true`） | parent 管理 |
| 对象映射 | `mapstruct` + processor | 1.4.2.Final |
| 本地缓存 | `caffeine` | 3.1.1 |
| Excel | `easyexcel` / `poi-ooxml` / `easypoi` | 4.0.1 / 4.1.2 / 4.5.0 |
| JSON | `fastjson` / `jackson-databind` | 1.2.79 / 2.12.0 |
| 云存储/短信 | `aliyun-sdk-oss` / `aliyun-log-logback-appender` | 3.10.2 / 0.1.18 |
| 二维码 | `zxing core` + `javase` | 3.5.1 |
| 连接池 | `commons-pool2`（Lettuce 池必需） | 2.11.1 |

::: warning 注意
`lombok` 与 `mapstruct` 共存时需要 `lombok-mapstruct-binding` 协调注解处理器顺序，项目引了 0.2.0 版本。
:::

## application.yml 组织与 profile 切换

### 文件组织

`web-gateway/src/main/resources` 下按"公共 + 环境"拆分：

```
application.yml          # 公共配置（端口、profile 激活、jackson、上传大小…）
application-dev.yml      # 开发环境：数据源、redis、日志级别、业务参数
application-test.yml
application-prod.yml
banner-{env}.txt         # 每个环境不同启动 banner，肉眼确认环境
logback-spring.xml
```

公共配置（节选，敏感值已用占位符）：

```yaml
spring:
  profiles:
    # @project@ 由 Maven 打包时替换成 dev/test/prod
    active: @project@
  servlet:
    multipart:
      max-request-size: 100MB
      max-file-size: 100MB
  jackson:
    time-zone: Asia/Shanghai
server:
  port: 8080
  servlet:
    context-path: /api
```

环境差异配置（`application-dev.yml` 节选）：

```yaml
spring:
  datasource:
    username: <DB_USER>
    password: <DB_PASSWORD>
    url: jdbc:mysql://<HOST>:3306/ceramics_dev?serverTimezone=Asia/Shanghai&rewriteBatchedStatements=true
    hikari:
      maximum-pool-size: 30
  redis:
    host: <REDIS_HOST>
    password: <REDIS_PASSWORD>
    lettuce:
      pool:
        max-active: 8
logging:
  level:
    org.hibernate.type.descriptor.sql.BasicBinder: trace   # 开发期打印 SQL 绑定参数
mybatis-plus:
  configuration:
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
```

### 项目的切换方式：Maven profile + 资源过滤

与常见的"启动时 `--spring.profiles.active=prod`"不同，这个项目把环境**固化在构建产物里**：

```xml
<!-- web-gateway/pom.xml（节选） -->
<build>
    <finalName>app</finalName>
    <resources>
        <resource>
            <directory>src/main/resources</directory>
            <includes>
                <include>application.yml</include>
                <include>application-${project}.yml</include>
                <include>logback-spring.xml</include>
            </includes>
            <filtering>true</filtering>   <!-- 开启占位符替换 -->
        </resource>
    </resources>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-resources-plugin</artifactId>
            <configuration>
                <delimiters>@</delimiters>   <!-- 用 @xxx@ 作占位符，避开 yml 里的 ${} -->
                <useDefaultDelimiters>false</useDefaultDelimiters>
            </configuration>
        </plugin>
    </plugins>
</build>

<profiles>
    <profile>
        <id>dev</id>
        <activation><activeByDefault>true</activeByDefault></activation>
        <properties><project>dev</project></properties>
    </profile>
    <profile>
        <id>prod</id>
        <properties><project>prod</project></properties>
    </profile>
    <!-- test 同理 -->
</profiles>
```

打包流程：

```
mvn package -P prod
   ↓ Maven profile 置 project=prod
   ↓ 资源过滤把 application.yml 里的 @project@ 替换为 prod
   ↓ includes 只打进 application.yml + application-prod.yml（其他环境配置不进包）
app.jar（环境已锁定）
```

两种切换方式对比：

| 方式 | 优点 | 缺点 |
| --- | --- | --- |
| Maven profile + 过滤（本项目） | 包里只有目标环境配置，不会误读；CI 按 profile 出包 | 一个包只能跑一个环境，换环境要重新打包 |
| `--spring.profiles.active` 启动参数 | 一个包通吃所有环境 | 所有环境配置都打进包里，注意敏感信息泄露 |

## @ConfigurationProperties 与 @Value

### 对比

| 维度 | `@ConfigurationProperties` | `@Value` |
| --- | --- | --- |
| 绑定方式 | 按前缀批量绑定到 POJO 字段 | 单个 key 注入到单个字段/参数 |
| 松散绑定 | 支持（`suite-id`/`suiteId`/`SUITE_ID` 都能对上） | 不支持，key 必须逐字符一致 |
| SpEL | 不支持 | 支持 |
| IDE 提示 | 配合 `spring-boot-configuration-processor` 有补全 | 无 |
| 校验 | 可加 `@Validated` | 不可 |
| 适用 | 一组结构化配置 | 零散的单值 |

### 项目实例

`application-dev.yml` 里的一段企业微信配置：

```yaml
wecom:
  suite-id: "<SUITE_ID>"
  suite-secret: "<SUITE_SECRET>"
  token: "<CALLBACK_TOKEN>"
  aes-key: "<AES_KEY>"
  corp-id: "<CORP_ID>"
  provider-secret: "<PROVIDER_SECRET>"
```

绑定类 `common` 模块的 `WeComConfig`——前缀 + Lombok 读写方法即可，字段用驼峰自动对上 yml 的 kebab-case：

```java
@Setter
@Getter
@Component
@ConfigurationProperties(prefix = "wecom")
public class WeComConfig {
    private String suiteId;
    private String suiteSecret;
    private String token;
    private String aesKey;
    private String corpId;
    private String providerSecret;
}
```

同类用法还有 `UserLoginConfig`（`prefix = "user"`，绑定 `default-expire: 365`）、`PrinterConfig`（`prefix = "printer-config"`）、`JacksonProperties`（`prefix = "jackson.config"`，控制 null 转空串、大数转字符串两个序列化开关）。

::: tip
注册绑定类两种方式：像项目这样直接标 `@Component`，或者在配置类上 `@EnableConfigurationProperties(XxxProperties.class)`。后者不污染组件扫描，starter 作者更常用。
:::

## Bean 注册常用手段

| 手段 | 说明 | 项目实例 |
| --- | --- | --- |
| 组件扫描 | `@SpringBootApplication` 扫描启动类所在包及子包 | 启动类放在 `com.fc.ceramics` 根包，各模块同包名层级所以全部被扫到 |
| `@Configuration` + `@Bean` | 方法返回值注册为 Bean，适合第三方类加注解 | `CorsConfig#corsFilter` 注册 `CorsFilter` |
| `@MapperScan` | 扫描 MyBatis 接口并注册代理 Bean | 启动类上 `@MapperScan("com.fc.ceramics.**.mapper")` |
| `@ServletComponentScan` | 启用 Servlet 原生注解 `@WebFilter`/`@WebServlet` | 项目用它激活 `ResubmitFilter`（`@WebFilter`） |
| `@Import` | 显式导入配置类/普通类，跨包注册利器 | 通用做法，本项目未用 |
| 自动配置 | starter 通过 `META-INF/spring.factories`（2.7+ 为 `AutoConfiguration.imports`）按 classpath 条件自动注册 Bean，`spring-boot-starter-*` 的本质 | 引入 `mybatis-plus-boot-starter` 后 `SqlSessionFactory` 等自动装配 |

另外项目开了 `spring.main.allow-bean-definition-overriding: true`，同名 Bean 允许后注册者覆盖——排查"注入的实现不对"时先想到这条配置。

## Docker 部署要点

### Dockerfile（项目真实文件）

```dockerfile
FROM registry.cn-beijing.aliyuncs.com/hub-mirrors/openjdk:11
ENV TimeZone=Asia/Shanghai

# 中文字体，解决报表/图片中文乱码
COPY doc/MSYHMONO.ttf /usr/share/fonts/truetype/dejavu/
ENV LANG C.UTF-8

COPY web-gateway/target/app.jar app.jar

ARG redisStreams
ENV REDIS_STREAMS=$redisStreams

ENTRYPOINT [ \
  "java","-Djava.security.egd=file:/dev/./urandom", \
  "-XX:InitialRAMPercentage=60.0", \
  "-XX:MaxRAMPercentage=60.0", \
  "-XX:MetaspaceSize=256m", \
  "-XX:MaxMetaspaceSize=512m", \
  "-XX:MaxDirectMemorySize=512m", \
  "-XX:ReservedCodeCacheSize=256m", \
  "-XX:+UseG1GC", \
  "-XX:MaxGCPauseMillis=200", \
  "-XX:+UseStringDeduplication", \
  "-XX:+UseContainerSupport", \
  "-jar","/app.jar", \
  "--redis.lettuce.pool.streams=${REDIS_STREAMS}" \
]
```

要点解读：

| 项 | 做法 | 原因 |
| --- | --- | --- |
| 构建分层 | Maven 先本地/CI 打出 `app.jar`，Docker 只 COPY 成品 | 简单直接；更优可做 multi-stage（builder 层跑 mvn，运行层只留 jdk+jar），镜像更小、环境一致 |
| JVM 堆 | `MaxRAMPercentage=60` 按容器内存百分比给堆 | 配合 `UseContainerSupport`，容器 limit 变了不用改参数，比写死 `-Xmx` 适合 K8s/云效 |
| 堆外 | `MetaspaceSize`/`MaxDirectMemorySize`/`ReservedCodeCacheSize` 分别封顶 | 防堆外内存无限膨胀把容器 OOM Kill |
| GC | G1 + `MaxGCPauseMillis=200` + 字符串去重 | 中堆场景默认选择 |
| 时区 | 基础镜像 ENV + 启动类兜底 | 见下 |
| 中文 | 拷字体 + `LANG C.UTF-8` | PDF/图片渲染不乱码 |
| 外部参数 | `ARG` 透传 `--redis.lettuce.pool.streams=...` | 部署时注入、不进镜像 |

时区在 Java 层还有一道保险——启动类里强制默认时区：

```java
@SpringBootApplication
@MapperScan("com.fc.ceramics.**.mapper")
@EnableAsync
@EnableScheduling
@ServletComponentScan
public class CeramicsApplication {
    @PostConstruct
    void started() {
        // 容器/宿主机时区不可控，启动即锁定东八区
        TimeZone.setDefault(TimeZone.getTimeZone("GMT+8"));
    }
    public static void main(String[] args) {
        SpringApplication.run(CeramicsApplication.class, args);
    }
}
```

配合 `spring.jackson.time-zone: Asia/Shanghai` 与 JDBC URL 的 `serverTimezone=Asia/Shanghai`，序列化、数据库、JVM 三处时区统一。

### deploy.sh（非容器场景）

裸机/虚机上用脚本管理进程，核心变量与流程：

```bash
APP_HOME=/home/admin/application
JAR_NAME=${APP_HOME}/target/application.jar
HEALTH_CHECK_URL=http://127.0.0.1:8080

start_application() {
    nohup java -jar ${JAR_NAME} > ${APP_HOME}/logs/start.log 2>&1 &
}
# health_check: 每秒 curl 一次，20 秒内拿到 200 才算启动成功，否则 exit 1
# stop: ps 找 pid，kill -9，最多轮询 60 秒
# 用法: deploy.sh {start|stop|restart}
```

可复用的模式：**部署脚本 = 停旧进程 → 起新进程 → 健康检查兜底**，CI（云效）产物 `package.tgz` 解压后由该脚本接管。

## 速查小结

- 多模块：`enum → common → service → web-gateway` 单向依赖，启动类放公共根包让组件扫描跨模块生效；生成器类工具单独成模块（coding-tool）。
- 版本：根 pom `dependencyManagement` 收口内部模块版本；第三方版本也应上收。
- profile：项目用 Maven profile + 资源过滤把环境烧进 jar（`@project@` 占位符 + includes 只打目标环境配置）；另一条路是启动参数切换。
- 配置绑定：成组配置用 `@ConfigurationProperties(prefix=...)`（松散绑定），单值用 `@Value`。
- Bean 注册：组件扫描 / `@Bean` / `@MapperScan` / `@ServletComponentScan` / `@Import` / starter 自动配置。
- Docker：成品 jar COPY 或 multi-stage；容器内存百分比给堆 + 堆外封顶；时区三处统一（JVM、Jackson、JDBC）；部署脚本带健康检查。
