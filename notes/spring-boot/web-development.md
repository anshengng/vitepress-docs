# Spring Boot Web 开发实践

以陶瓷行业后端 `cihua_backinterface` 的 `web-gateway` 模块为底料，整理 REST 接口写法、参数校验、统一响应、全局异常、拦截器/过滤器/AOP 与跨域配置的真实做法，补充通用对比，可直接照搬到同类 Spring MVC 项目。

## REST 接口与参数接收

三种主流接收方式对比：

| 注解 | 参数来源 | 典型场景 | 项目实例 |
| --- | --- | --- | --- |
| `@RequestParam` | URL query / 表单 | 单个简单参数 | `ProcessShelfController#getById` |
| `@PathVariable` | URL 路径占位符 | 资源定位（RESTful 风格） | `SupplierController#update`（路径带 id） |
| `@RequestBody` | JSON 请求体 | 复杂对象/列表 | 项目绝大多数增删改查接口 |
| `@RequestHeader` | 请求头 | token、租户标识 | `JwtAuthorizationFilter` 直接读 header 中的 token/appid |

项目真实代码（`ProcessShelfController`，节选）：

```java
@RestController
@RequestMapping(value = "/v1/processshelf")
@Api(tags = "车间坯车管理")
public class ProcessShelfController {

    @PostMapping("/addProcessshelf")
    public ApiResult<ProcessShelf> addProcessshelf(@RequestBody @Valid AddProcessshelfRequest request) {
        return ApiResult.ok(processShelfService.addProcessShelf(request));
    }

    @GetMapping("/getById")
    public ApiResult<Object> getById(@RequestParam("id") Long id) {
        return ApiResult.ok(processShelfService.getById(id));
    }
}
```

混合用法（路径参数 + 请求体同时出现，`SupplierController`）：

```java
@PostMapping("/update/{id}")
public ApiResult<Supplier> update(@RequestBody @Valid SupplierDto supplierDto,
                                  @PathVariable Long id) { ... }
```

::: tip 项目风格
即使是查询/分页也统一用 `POST + @RequestBody`（如 `queryProcessshelfList`），好处是复杂查询条件不受 URL 长度限制、DTO 结构统一；代价是不完全 RESTful，读操作不再幂等于 GET。团队内保持一致即可。
:::

## 参数校验

依赖：`spring-boot-starter-validation`（在 `common/pom.xml` 引入，JSR380 即 Bean Validation 2.0，实现为 Hibernate Validator）。

### 常用注解速查

| 注解 | 作用于 | 语义 |
| --- | --- | --- |
| `@NotNull` | 任意类型 | 值不得为 null |
| `@NotBlank` | 字符串 | 去空格后非空 |
| `@NotEmpty` | 字符串/集合 | 至少一个元素 |
| `@Size(min, max)` | 字符串/集合 | 长度/大小范围 |
| `@Min` / `@Max` | 数值 | 范围 |
| `@Pattern` | 字符串 | 正则 |
| `@Email` | 字符串 | 邮箱格式 |

### 项目实例

DTO 上直接标注解并带中文 message（`AddProcessshelfRequest`）：

```java
@Data
public class AddProcessshelfRequest {
    @NotNull
    @Size(max = 50, message = "名称最多50字")
    @ApiModelProperty(value = "坯车名称", required = true)
    private String processShelfName;

    @Size(max = 200, message = "备注最多200字")
    private String remark;
}
```

Controller 参数前加 `@Valid` 触发校验，失败抛 `BindException`，由全局异常处理器统一转成响应（见下一节）。

### 分组校验（通用写法）

同一个 DTO 复用于新增/修改、但必填规则不同时，用分组：

```java
// 定义空接口作分组标记
public interface Create {}
public interface Update {}

// DTO：id 仅修改时必填
public class XxxDto {
    @NotNull(groups = Update.class)
    private Long id;

    @NotBlank(groups = { Create.class, Update.class })
    private String name;
}

// Controller：用 @Validated 指定本次校验的分组
@Validated(Update.class)
@RequestBody XxxDto dto
```

**项目实际做法**：没有用 groups，而是**每个接口一个 Request 类**（`AddProcessshelfRequest` / `EditProcessshelfRequest` 分开），天然隔离校验规则，代价是类数量多。两种取舍：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 一接口一 DTO（项目） | 简单直观，Swagger 文档精确 | DTO 膨胀 |
| 共享 DTO + groups | 类少 | 注解上维护分组易漏，文档可读性差 |

### 集合与业务校验

- 校验 `List` 元素：项目写了包装类 `ValidatedList`——内部持有 `@Valid` 字段并实现 `List` 接口，把整个列表作为 `@RequestBody` 传入即可逐元素触发校验（Spring 只校验"对象及其 @Valid 字段"，不校验裸集合泛型）。
- 注解表达不了的规则放 Service：如名称唯一性 `processShelfService.validateNameUnique(request)`、批量创建数量上限判断，不满足直接 `throw new BusinessException(ResultEnum.BUSINESS, "重复请求...")`。

## 统一响应结构

`common` 模块的 `ApiResult`（节选，保留主干）：

```java
@Data
@Builder
@AllArgsConstructor
public class ApiResult<T> implements Serializable {
    private int code;          // 业务码，见 ResultEnum
    private boolean success;   // 布尔位，前端 if 判断方便
    private String message;    // 提示语
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date time;         // 响应时间戳
    private T data;            // 泛型载荷

    public static <T> ApiResult<T> ok(T data) {
        return ApiResult.<T>builder()
                .code(ResultCode.SUCCESS.getCode())
                .message(ResultCode.SUCCESS.getMsg())
                .data(data)
                .success(true)
                .time(new Date())
                .build();
    }

    public static <T> ApiResult<T> error(ResultEnum resultEnum, String message) {
        return ApiResult.<T>builder()
                .code(resultEnum.getCode())
                .message(message)
                .data(null)
                .success(false)
                .time(new Date())
                .build();
    }
    // ok() / fail() / fail(data) / errors(...) 等工厂方法同理
}
```

配套枚举 `ResultEnum`：

```java
@Getter
public enum ResultEnum {
    UNKONW_ERROR(-1, "未知错误"),
    OK(200, "操作成功"),
    FAIL(999, "操作失败"),
    SERVER_ERROR(1000, "服务异常"),
    BUSINESS(400, "业务异常"),
    ERROR(500, "系统内部错误");

    private Integer code;
    private String msg;
}
```

设计要点：

- **Controller 返回类型统一是 `ApiResult` 泛型**，业务数据只放 `data`，异常路径也返回同结构（HTTP 状态仍是 200，靠 `code`/`success` 区分）。
- 静态工厂收敛构造逻辑，业务代码只写 `ApiResult.ok(x)` / `ApiResult.error(enum, msg)`。
- `time` 字段方便前端/排查对时；`success` 布尔位避免前端硬编码 `code == 200`。

## 全局异常处理

`service` 模块的 `GlobalExceptionHandler`，`@RestControllerAdvice` 单点兜底（骨架节选）：

```java
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler implements RequestBodyAdvice {

    // ThreadLocal 缓存请求体，异常时能带出"用户到底提交了什么"
    private static final ThreadLocal<Object> reqBodyHolder = new ThreadLocal<>();

    @ExceptionHandler(value = Exception.class)
    @ResponseBody
    public ApiResult<Object> exceptionHandler(HttpServletRequest httpRequest, Exception e) throws Exception {
        StringBuilder msg = new StringBuilder();

        if (e instanceof HttpRequestMethodNotSupportedException) {
            // 方法不支持：提示接口仅支持哪些 method
        }
        if (e instanceof BindException) {
            // @Valid 校验失败：逐字段拼 "字段名: message"
            BindingResult bindingResult = ((BindException) e).getBindingResult();
            for (FieldError fe : bindingResult.getFieldErrors()) {
                msg.append(fe.getField()).append(": ").append(fe.getDefaultMessage()).append(". ");
            }
        }
        if (e instanceof HttpMessageNotReadableException) {
            // JSON 解析失败 / body 为空
        }
        if (e instanceof MethodArgumentTypeMismatchException) {
            // 参数类型不匹配
        }
        if (e instanceof NonTransientDataAccessException) {
            // 数据库异常
        }
        // ... 组装 LogItem（url、method、header、body、堆栈前 5 帧）
        logService.pushLogs("ExceptionInfo", logItemList);   // 上报阿里云 SLS
        return ApiResult.error(ResultEnum.FAIL, msg.toString());
    }

    @Override
    public Object afterBodyRead(Object body, HttpInputMessage inputMessage, ...) {
        reqBodyHolder.set(body);   // RequestBodyAdvice 钩子：读 body 后暂存
        return body;
    }
}
```

处理流程：

```
Controller/Service 抛异常（含 BusinessException）
        ↓
DispatcherServlet 捕获，交给 @RestControllerAdvice
        ↓
@ExceptionHandler(Exception.class) 兜底
   ├── instanceof 分支：BindException → 拼字段错误
   │                    TypeMismatch → 拼类型提示
   │                    其他 → e.getMessage()
   ├── 组装 LogItem：url/method/header/body/堆栈前5帧
   ├── 上报 SLS（logService.pushLogs）
   └── return ApiResult.error(FAIL, msg)   ← 前端拿到统一结构
```

业务异常的主动抛出方式（`ProcessShelfController` 真实代码）：

```java
if (startNum > endNum) {
    throw new BusinessException(ResultEnum.BUSINESS, "编号输入异常, 起始编号不能大于结束编号");
}
```

::: warning 经验点
- 项目只写了一个 `Exception.class` 大兜底 + instanceof 分流，简单粗暴但可读性一般；更常见的写法是按异常类型拆多个 `@ExceptionHandler` 方法。
- 实现 `RequestBodyAdvice` 抓请求体是为了"异常时日志带 body"，注意 `getReqBody` 里 finally `remove()`，否则线程池复用会串数据/内存泄漏。
- 认证失败的异常不走这里——它在 Filter 层，由 Spring Security 的 `JwtAuthenticationEntryPoint`/`JwtAccessDeniedHandler` 处理（见下节）。
:::

## 拦截器 vs 过滤器 vs AOP

### 时机图

```
客户端请求
   ↓
┌ Filter ────────────────────────────────────────────┐
│ CorsFilter → JwtAuthorizationFilter → ResubmitFilter│  Servlet 容器层
│ （能改 request/response，看不到 Controller 方法）    │  进 DispatcherServlet 前
└────────────────────────────────────────────────────┘
   ↓
Interceptor preHandle      MerchantIdInterceptor      SpringMVC 层
   ↓                       （能拿到 handler 方法）     已做参数绑定前
   ↓  @Valid 参数绑定/校验（失败抛 BindException）
┌ AOP ───────────────────────────────────────────────┐
│ @Before DisableResubmitAspect                       │  方法调用层
│ （只拦截标注解的方法，能拿到实参）                    │  已进入 Controller 代理
└────────────────────────────────────────────────────┘
   ↓
Controller 方法执行 → Service → Mapper
   ↓
AOP @AfterReturning / @Around 返回处
   ↓
Interceptor postHandle
   ↓
Filter 响应回写阶段
   ↓
Interceptor afterCompletion   ThreadLocalCleanInterceptor
                              （无论成败都执行，清 ThreadLocal）
```

### 三者对比

| 维度 | Filter | Interceptor | AOP |
| --- | --- | --- | --- |
| 规范/层 | Servlet 规范，容器层 | SpringMVC，DispatcherServlet 内 | Spring 容器，代理对象方法级 |
| 时机 | 进 MVC 前/出响应后 | preHandle → 绑定校验 → postHandle → afterCompletion | 目标方法前后/周围 |
| 能拿到 | 原始 request/response | handler（Controller 方法元信息） | 方法签名与实参 |
| 典型用途 | 跨域、认证、压缩 | 登录态校验、ThreadLocal 清理 | 防重提交、日志、事务、缓存 |

### 项目实例

**Filter — JWT 鉴权**（`JwtAuthorizationFilter`，继承 Spring Security 的 `BasicAuthenticationFilter`，在 `SecurityConfiguration` 中 `addFilter` 注册）：

```java
@Override
protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                FilterChain chain) throws IOException, ServletException {
    // 先清 ThreadLocal，防线程池串数据
    ThreadLocalUtils.remove(MyConstants.TOKEN);
    ThreadLocalUtils.remove(MyConstants.MERCHANT_ID);

    String token = request.getHeader(SecurityConstants.TOKEN_HEADER);
    if (token == null || !token.startsWith(SecurityConstants.TOKEN_PREFIX)) {
        SecurityContextHolder.clearContext();   // 无 token 也放行，
        chain.doFilter(request, response);      // 交给 Security 授权层拒绝
        return;
    }
    // 解析 token + 与 Redis 中的最新 token 比对（实现单点登录/踢人下线）
    String previousToken = (String) redisUtil.get("token:userId:" + id);
    if (!Objects.equals(tokenValue, previousToken)) { ... }
    SecurityContextHolder.getContext().setAuthentication(authentication);
    chain.doFilter(request, response);
}
```

**Filter — 同用户串行**（`ResubmitFilter`，用 `@WebFilter` + 启动类 `@ServletComponentScan` 激活）：同一 `userId + URI` 的请求用 `synchronized(UserLockUtils.getLock(key))` 排队，防并发写冲突。

**Interceptor — ThreadLocal 生命周期**（`WebConfig` 注册）：

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(merchantIdInterceptor);
        registry.addInterceptor(threadLocalCleanInterceptor).addPathPatterns("/**");
    }
}
```

`ThreadLocalCleanInterceptor` 只有 `afterCompletion`，请求结束统一 `ThreadLocalUtils.remove()`；`MerchantIdInterceptor` 同理在 `afterCompletion` 移除租户 id。

**AOP — 注解式防重提交**（`DisableResubmitAspect`，Controller 方法标 `@DisableResubmit`）：

```java
@Aspect
@Component
public class DisableResubmitAspect {
    @Pointcut("@annotation(com.fc.ceramics.commons.annotions.DisableResubmit)")
    public void disableResubmit() {}

    @Before("disableResubmit()")
    public void doBefore(JoinPoint joinPoint) {
        // key = 商户id + URI；value = 全部入参 JSON 的 MD5
        String keyStr = JwtTokenUtils.getMerchantId() + "&" + request.getRequestURI();
        String valMd5 = MD5Util.encode(所有参数序列化);
        if (valMd5.equals(redisUtil.get(keyStr))) {
            throw new BusinessException(ResultEnum.BUSINESS, "重复请求, 请稍后重试");
        } else {
            redisUtil.set(keyStr, valMd5, 15);   // 15 秒窗口
        }
    }
}
```

请求日志切面 `RequestLogAspect`（`@Before` 打印 url/参数/body）项目里已整段注释，改由全局异常处理器 + SLS 统一采集——日志切面与统一异常采集二选一即可，别重复打。

### 鉴权配置串起来

`SecurityConfiguration`（Spring Security 5.5 风格，继承 `WebSecurityConfigurerAdapter`）：

```java
@EnableWebSecurity
@EnableGlobalMethodSecurity(prePostEnabled = true)
public class SecurityConfiguration extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.cors(withDefaults())
            .csrf().disable()
            .authorizeRequests()
            .antMatchers(SecurityConstants.SWAGGER_WHITELIST).permitAll()  // swagger 放行
            .antMatchers(SecurityConstants.SYSTEM_WHITELIST).permitAll()   // 登录等白名单
            .anyRequest().authenticated()
            .and()
            .addFilter(new JwtAuthorizationFilter(authenticationManager(), getApplicationContext()))
            .sessionManagement().sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            .and()
            .exceptionHandling()
            .authenticationEntryPoint(new JwtAuthenticationEntryPoint())  // 未认证 → 401
            .accessDeniedHandler(new JwtAccessDeniedHandler());           // 无权限 → 403
    }
}
```

链路：`CorsFilter` 放行预检 → `JwtAuthorizationFilter` 解析 token 填充 `SecurityContext` → URL 授权规则拦截 → 方法级 `@PreAuthorize`（`prePostEnabled`）→ 异常由自定义 EntryPoint/DeniedHandler 输出统一 JSON。

## 跨域配置

项目实际用的是 **`CorsFilter` Bean** 方案（`web-gateway` 的 `CorsConfig`）：

```java
@Configuration
public class CorsConfig {
    private CorsConfiguration buildConfig() {
        CorsConfiguration corsConfiguration = new CorsConfiguration();
        corsConfiguration.addAllowedOrigin("*");   // 允许任何域名
        corsConfiguration.addAllowedHeader("*");   // 允许任何头
        corsConfiguration.addAllowedMethod("*");   // 允许任何方法
        return corsConfiguration;
    }

    @Bean
    public CorsFilter corsFilter() {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", buildConfig());
        return new CorsFilter(source);
    }
}
```

同时 `SecurityConfiguration` 里还注册了 `CorsConfigurationSource` Bean 并开启 `http.cors(withDefaults())`，暴露 `Authorization` 响应头、`maxAge 3600`。带 Spring Security 的项目务必保证 CORS 过滤器在授权链之前生效，否则预检请求会被 401 拦掉。

其他方案一句话：

- `WebMvcConfigurer#addCorsMappings`：MVC 层配置，走不进 Security 过滤器链的请求（如静态资源之外的自定义 Filter）不生效。
- `@CrossOrigin`：标注在 Controller/方法上，粒度最细但散落难维护。
- Nginx 反向代理加 `Access-Control-Allow-*` 头：前后端同源部署，后端零配置，生产最省心。

::: warning
`allowedOrigin("*")` 与 `allowCredentials(true)` 互斥（Spring 新版本会直接报错）；生产环境应收敛为白名单域名 + `allowedOriginPatterns`。
:::

## 速查小结

- 参数接收：简单参数 `@RequestParam`、路径 `@PathVariable`、复杂对象 `@RequestBody` + DTO；项目查询也统一 POST + body。
- 校验：DTO 注解 + `@Valid` 触发；项目用"一接口一 DTO"替代分组；集合校验用 `ValidatedList` 包装；业务规则在 Service 抛 `BusinessException`。
- 响应：`ApiResult`（code/success/message/time/data + 静态工厂），异常路径同结构，HTTP 恒 200。
- 异常：`@RestControllerAdvice` 兜底 `Exception`，instanceof 分流拼友好消息，`RequestBodyAdvice` + ThreadLocal 带出请求体，上报 SLS。
- 三层时机：Filter（容器，跨域/鉴权）→ Interceptor（MVC，preHandle/postHandle/afterCompletion 清 ThreadLocal）→ AOP（方法级，`@DisableResubmit` 防重）。
- 鉴权链：Security STATELESS + 白名单 + 自定义 JWT Filter + EntryPoint/DeniedHandler。
- 跨域：`CorsFilter` Bean 全局注册 `/**`；生产收敛 origin 白名单，注意与 credentials 互斥。
