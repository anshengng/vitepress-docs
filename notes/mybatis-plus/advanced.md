# MyBatis-Plus 进阶

本页在 [基础用法](/notes/mybatis-plus/basic-usage) 与 [Wrapper 条件构造器](/notes/mybatis-plus/wrapper) 之上，讲用法层更深的部分：代码生成器、分页插件扩展点、逻辑删除边界、自动填充、乐观锁、自定义 SQL 与服务层组织套路。示例底料来自一个真实 Spring Boot 2.5.5 + MP 3.4.3.2 的多模块项目（service 模块承载业务，coding-tool 模块是代码生成器），敏感配置一律用占位符。

## 代码生成器（coding-tool）

项目单独开一个 `coding-tool` 模块放生成器，依赖 `mybatis-plus-generator` 3.4.0 + `velocity-engine-core` 2.1（模板引擎），入口就是一个 `main` 方法直接跑的 `CustomGenerator` 类。

```java
// 老版 AutoGenerator API（3.4.x），新版 3.5.x 改用 Builder 风格
AutoGenerator gen = new AutoGenerator();

// 1. 数据源：连哪个库读表结构
gen.setDataSource(new DataSourceConfig()
        .setDbType(DbType.MYSQL)
        .setDriverName("com.mysql.cj.jdbc.Driver")
        .setUrl("jdbc:mysql://<数据库地址>:3306/<库名>?useUnicode=true&characterEncoding=utf-8&serverTimezone=Asia/Shanghai")
        .setUsername("<用户名>")
        .setPassword("<密码>"));

// 2. 全局配置：产物写到哪、叫什么名
gen.setGlobalConfig(new GlobalConfig()
        .setOutputDir(projectPath + "/service/src/main/java") // 直接输出进业务模块
        .setFileOverride(true)        // 重新生成时覆盖旧文件（危险：手改过的代码会被冲掉）
        .setBaseResultMap(true)       // XML 里生成 resultMap
        .setBaseColumnList(true)      // XML 里生成通用列片段
        .setAuthor(System.getProperty("user.name"))
        .setMapperName("%sMapper")    // 产物命名模板：%s 替换为表名去前缀后的驼峰名
        .setXmlName("%sMapper")
        .setServiceName("%sService")
        .setServiceImplName("%sServiceImpl")
        .setControllerName("%sController"));

// 3. 策略配置：表名/字段名怎么翻译
String prefix = "f_";                 // 项目所有业务表统一 f_ 前缀
gen.setStrategy(new StrategyConfig()
        .setTablePrefix(prefix)       // 生成实体类名时去掉 f_
        .setNaming(NamingStrategy.underline_to_camel) // 下划线转驼峰
        .setInclude(new String[]{"f_decalsheet", "f_supplier_decalsheet"}) // 只生成指定表
        .setRestControllerStyle(true) // 生成 @RestController + @RequestMapping
        .setEntityLombokModel(true)   // 实体用 @Data
        .setEntityBooleanColumnRemoveIsPrefix(true) // is_xxx 布尔列生成字段时去掉 is 前缀
        // .setLogicDeleteFieldName("is_deleted")   // 逻辑删除字段（本项目注释掉了，实体自己标 @TableLogic）
);

// 4. 包配置：各产物落到哪个包
gen.setPackageInfo(new PackageConfig()
        .setParent("com.fc.ceramics.decalsheet") // 按业务模块分父包
        .setEntity("entity").setMapper("mapper")
        .setService("service").setServiceImpl("service.impl")
        .setXml("src/main/resources/mapper"));   // XML 输出到 resources

gen.execute(); // 运行 main 即生成
```

各配置块职责一览：

| 配置块 | 管什么 | 关键参数 |
| --- | --- | --- |
| `DataSourceConfig` | 连库读元数据 | url / username / driverName |
| `GlobalConfig` | 输出位置与命名 | outputDir、fileOverride、baseResultMap、`%sMapper` 等命名模板 |
| `StrategyConfig` | 表到类/字段的翻译规则 | tablePrefix、naming、include/exclude、lombok、逻辑删除字段 |
| `PackageConfig` | 包结构 | parent + entity/mapper/service/xml 子包 |
| `TemplateConfig`（本项目未用） | 换自定义模板 | 默认用 jar 内置 Velocity 模板，项目没放 `templates/*.vm`，即全默认产物 |

生成产物结构（对应上面配置）：`entity/`、`mapper/`、`service/`、`service/impl/`、`controller/` 五个 Java 包 + `resources/mapper/` 下的 XML。生成器只是起点——本项目惯例是生成后把 Controller 里无用的脚手架删掉，Service 再按业务改写。

> 同模块还有一个 `DateDimensionTableGenerator`，它不是 MP 生成器，只是用 `main` 方法循环拼 INSERT 语句、导出日期维度表 SQL 脚本的一次性工具。这类"跑 main 生成代码/脚本"的模块单独隔离依赖，不打包进生产。

## 分页插件原理与扩展点

**原理一句话**：`PaginationInnerInterceptor` 是 MP 拦截器链里的一个内部拦截器，在 SQL 执行前改写语句——先拿原 SQL 包一层 `SELECT COUNT(*)` 查总数，再按 `Page` 参数给原 SQL 拼上 `LIMIT`。所以它只认 `IPage` 参数，注册与否决定分页生不生效（见 [基础用法](/notes/mybatis-plus/basic-usage)）。

本项目的注册就一行 `new PaginationInnerInterceptor(DbType.MYSQL)`，够用。常用扩展点：

```java
PaginationInnerInterceptor pagination = new PaginationInnerInterceptor(DbType.MYSQL);
pagination.setMaxLimit(500L);   // 单页条数上限，防止前端传 size=100000 拖垮数据库
pagination.setOverflow(false);  // 页码超出总页数时返回空页而不是回到第一页
// optimizeJoin：分页 count 前把 LEFT JOIN 去掉以提速，
// 但 WHERE/ON 里引用了 join 表列时必须关掉（默认 true），否则 count 结果错
// pagination.setOptimizeJoin(false);
interceptor.addInnerInterceptor(pagination);
```

| 扩展点 | 默认 | 什么时候动它 |
| --- | --- | --- |
| `maxLimit` | 无限制 | 对外接口必须设，防大页拖库 |
| `optimizeJoin` | `true` | count SQL 因去 join 报错/结果不对时设 `false` |
| `overflow` | `false` | 希望越界页码回首页时设 `true` |
| 自定义 count | 自动包 `COUNT` | 复杂 SQL 自动 count 低效或报错时，见下文"自定义 SQL 的分页" |

## 逻辑删除进阶

### 全局配置 vs 字段注解

本项目两层都用了：

```yaml
# application.yml（全局：只定"值"，不定"哪个字段"）
mybatis-plus:
  global-config:
    db-config:
      logic-delete-value: true       # 已删除值（tinyint(1) 列写 true/false 等价 1/0）
      logic-not-delete-value: false  # 未删除值
```

```java
// 实体：用 @TableLogic 声明哪个字段是删除标记，值沿用全局配置
@TableLogic
private Integer deleted;
```

两种方式对比：

| 方式 | 配置点 | 生效范围 |
| --- | --- | --- |
| 全局 `logic-delete-field: deleted` | yml，字段名匹配即生效 | 所有实体，无需注解 |
| `@TableLogic` 注解 | 逐个实体标 | 只有标了的字段生效，可在注解上单独覆盖删除/未删除值 |

项目里两种混用会踩坑：全局配了 `logic-delete-value: true` 后，某个实体用 `@TableLogic(delval = "2")` 单独覆盖，查询追加的条件就是 `deleted = 0`（notdel 也覆盖），排查时容易只看 yml 忽略注解。

### 自动拼条件的影响范围

MP 自动追加 `deleted = 0` / 把 delete 转 update，**只作用于 MP 内置方法**：

| 会带逻辑删除条件 | 不会带（要自己处理） |
| --- | --- |
| `selectById / selectList / selectPage / selectCount / exists` | 自定义 XML / `@Select` 注解 SQL |
| `deleteById / delete(wrapper) / updateById / update(entity, wrapper)` | `Wrapper.apply()` / `last()` 手写的片段 |
| `IService` 的 `getById / list / page / remove` 等 | MPJ 的 join 表——主表自动带，**join 表条件要写在 `on` 里** |

本项目的做法：自定义 XML 一律手写 `deleted = 0`，join 时把它放进 `ON` 而不是 `WHERE`（放 WHERE 会把 LEFT JOIN 退化成 INNER JOIN）：

```xml
<!-- GroupMapper.xml 真实写法：join 表的删除条件放 ON 里 -->
LEFT JOIN f_process p ON p.id = pst.process_id AND p.deleted = 0
WHERE ... AND s.deleted = 0
```

### 唯一索引与逻辑删除冲突

表上有唯一索引（如 `uk_user_name`）+ 逻辑删除，会出现：用户"删除"后行还在，再建同名用户直接撞唯一键。常见解法：

1. 唯一索引改为 `(user_name, deleted)` 联合——但同一个人只能"删一次"，第二次删除又撞键；
2. 进阶方案：删除时把 `deleted` 写成主键 id 或时间戳（非 0 即已删，`@TableLogic(delval = "id")` 思路需自定义 injector 或 SQL 配合），唯一索引 `(user_name, deleted)` 就彻底不冲突；
3. 业务层兜底：查询时带上已删除记录判重，恢复而非新建。

## 自动填充 MetaObjectHandler

[基础用法](/notes/mybatis-plus/basic-usage) 里实体标了 `@TableField(fill = ...)` 只是"声明"，真正干活的是实现 `MetaObjectHandler` 的 Bean。本项目的真实实现（`config/MyMetaObjectHandler`）：

```java
@Slf4j
public class MyMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        // 先 hasGetter + 判空再填：该实体没有这个字段、或调用方已手动赋值，都不覆盖
        if (metaObject.hasGetter("gmtCreate") && metaObject.getValue("gmtCreate") == null) {
            this.setFieldValByName("gmtCreate", new Date(), metaObject);
        }
        if (metaObject.hasGetter("gmtDate") && metaObject.getValue("gmtDate") == null) {
            this.setFieldValByName("gmtDate", new Date(), metaObject);
        }
        // 创建人从 JWT 取当前登录用户 id；定时任务等无请求上下文时取不到，忽略即可
        try {
            String uid = JwtTokenUtils.getId();
            if (metaObject.hasGetter("createUser") && metaObject.getValue("createUser") == null) {
                this.setFieldValByName("createUser", uid == null ? null : Long.parseLong(uid), metaObject);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        // 更新时间和更新人：每次 update 无条件覆盖
        this.setFieldValByName("gmtModified", new Date(), metaObject);
        try {
            String uid = JwtTokenUtils.getId();
            this.setFieldValByName("updateUser", uid == null ? null : Long.parseLong(uid), metaObject);
        } catch (Exception ignored) {
        }
    }
}
```

配套的实体字段（项目统一 `gmtCreate / gmtModified / createUser / updateUser` 四件套，而不是 create_time/update_time 命名）：

```java
@TableField(fill = FieldFill.INSERT) // 插入时填充
private Date gmtCreate;

@TableField(fill = FieldFill.UPDATE) // 更新时填充
private Date gmtModified;

@TableField(fill = FieldFill.INSERT)
private Long createUser;

@TableField(fill = FieldFill.UPDATE)
private Long updateUser;
```

套路总结：

- `FieldFill.INSERT` / `UPDATE` / `INSERT_UPDATE` 决定处理器在哪个时机被调到；
- 处理器里用 `hasGetter` 防御——一个全局 Bean 服务所有实体，不是每个实体都有这些字段；
- **填充只在 MP 内置方法（insert/updateById 等）和走 MP 的 Wrapper 更新时触发**，自定义 XML 的 update 不会触发；
- 本项目把"当前操作人"塞进填充逻辑，审计字段零成本落库；注册方式是配置类里 `@Bean` 手动 new（也可以直接 `@Component`）。

## 乐观锁 @Version

**本项目没有启用乐观锁**（全局搜不到 `@Version`，也没注册 `OptimisticLockerInnerInterceptor`），并发控制靠业务层状态机判断。通用做法记在这里备用：

```java
// 1. 注册内部拦截器（要加分页之后，顺序影响拦截链）
interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());

// 2. 实体加版本字段
@Version
private Integer version;
```

生效后 `updateById` 会拼上 `WHERE id = ? AND version = ?`，并把 version +1。局限：

| 局限 | 说明 |
| --- | --- |
| 只支持 `updateById` / `update(entity, wrapper)` | 自定义 SQL、`lambdaUpdate().set().update()` 不带版本条件 |
| 查询先行 | 必须先查出带 version 的实体再更新，否则条件里 version 为 null 直接跳过乐观锁 |
| 冲突后要自己重试 | 更新返回 0 行只说明撞版本，重试/提示由业务决定 |

库存扣减这类高频冲突场景，更常见的做法其实是 `UPDATE ... SET stock = stock - #{n} WHERE stock >= #{n}` 的原子 SQL，而不是乐观锁重试。

## 自定义 SQL

单表搞不定的聚合、多表、复杂条件，就回到 MyBatis 本体。本项目三种形态都有真实例子。

### Mapper XML

`resources/mapper/*.xml`（MP 默认 `mapper-locations` 就是 `classpath*:/mapper/**/*.xml`，项目 yml 里没配也能扫到）。复杂结果集用 `resultMap` 手工映射，例如采购单分页：

```xml
<select id="queryPurchaseOrderPage" resultMap="purchaseOrderMap">
    SELECT po.*
    FROM f_purchase_order po
    ${ew.customSqlSegment}
</select>
```

### 注解 SQL

简单的一句 SQL 不值得开 XML，`MaterialCategoryMapper` 的写法：

```java
@Select("SELECT MAX(sort) FROM f_material_category " +
        "WHERE material_category_parent_id = #{parentId} AND merchant_id = #{merchantId}")
Integer selectMaxSortByParentIdAndMerchantId(Long parentId, Long merchantId);
```

### Wrapper 传入自定义 SQL

Mapper 方法参数标 `@Param(Constants.WRAPPER)`（即 `"ew"`），XML 里就能引用 Wrapper 拼好的片段——这是把 [Wrapper 条件构造器](/notes/mybatis-plus/wrapper) 的动态条件能力带进手写 SQL 的桥：

| 占位符 | 内容 |
| --- | --- |
| `${ew.customSqlSegment}` | 完整 `WHERE ...`（含逻辑删除条件），最常用 |
| `${ew.sqlSegment}` | 只有条件本体，不带 WHERE 关键字；条件为空时是空串 |
| `${ew.whereEntity}` / `ew.entity` | Wrapper 里 `setEntity()` 挂的实体，可在 XML 里逐字段取值 |

```java
// Mapper：Wrapper 作为参数
Page<PurchaseOrder> queryPurchaseOrderPage(Page<Object> page,
        @Param(Constants.WRAPPER) Wrapper<PurchaseOrder> wrapper);
```

```java
// Service：条件用 lambda 照常拼，只是终点换成了自定义方法
LambdaQueryWrapper<PurchaseOrder> wrapper = new LambdaQueryWrapper<>();
wrapper.eq(PurchaseOrder::getMerchantId, merchantId)
       .eq(ObjectUtil.isNotNull(request.getStatus()), PurchaseOrder::getStatus, request.getStatus())
       .orderByDesc(PurchaseOrder::getGmtCreate);
Page<PurchaseOrder> page = getBaseMapper().queryPurchaseOrderPage(request.getPage(), wrapper);
```

注意 `${}` 是字符串拼接，Wrapper 生成的值本身走 `#{}` 预编译占位，所以从 Wrapper 传入是安全的；**不要**在 XML 里用 `${}` 直接拼用户输入。

### 自定义 SQL 的分页与 count

把 `IPage` 作为第一个参数传进自定义方法，分页插件同样会拦截并自动生成 count SQL（包一层 `SELECT COUNT(*) FROM (原SQL)`）。本项目 `queryPurchaseOrderPage` 就是这么用的。自动 count 失效/低效时的处理：

1. **给 Wrapper 传实体辅助**：复杂 SQL 自动 count 把整个 join 包进子查询太慢时，可另写一条 count 方法手动调用，再 `page.setSearchCount(false)` 关掉自动 count，`page.setTotal(手查的值)`；
2. **countId 指定 count 语句**：`page.setCountId("queryPurchaseOrderPage_COUNT")`，XML 里写一条同名 `<select resultType="Long">` 专供 count 用；
3. GROUP BY 的聚合 SQL 自动 count 结果会错（每组算一行），同样用 1 或 2 的方式绕。

本项目的聚合统计干脆不分页，Wrapper 传条件、SQL 自己 SUM：

```java
// DeliveryOrderMapper：MPJ 的 Wrapper 也能当 ew 传入
DeliveryOrderAllVO selectAggregatedStats(@Param(Constants.WRAPPER) MPJLambdaWrapper<DeliveryOrder> wrapper);
```

```xml
<select id="selectAggregatedStats" resultType="...DeliveryOrderAllVO">
    SELECT SUM(t.total_num) AS totalSuccNum, SUM(t.sell_price) AS totalSalary
    FROM f_delivery_order t
    ${ew.customSqlSegment}
</select>
```

### 多表查询：MPJ 还是手写 XML

本项目的分流策略很清晰：

- **两三个表的简单 join** → `mybatis-plus-join`（MPJ 1.4.9）。Mapper 继承 `MPJBaseMapper`、Service 继承 `MPJBaseServiceImpl`（如 `ProcessMapper extends MPJBaseMapper<Process>`），用 `JoinWrappers.lambda()` 构造：

```java
MPJLambdaWrapper<PurchaseOrder> wrapper = JoinWrappers.lambda(PurchaseOrder.class);
wrapper.selectAll(PurchaseOrder.class)
       .leftJoin(PurchaseOrderDetail.class, PurchaseOrderDetail::getOrderId, PurchaseOrder::getId)
       .eq(PurchaseOrderDetail::getMerchantId, merchantId);
List<PurchaseOrder> list = mapper.selectList(wrapper); // 主表逻辑删除自动带，join 表条件写在 on 里
```

- **三表以上、带子查询/窗口聚合的报表 SQL** → 手写 XML + resultMap（项目里 `GroupMapper.xml`、`ProductOrderMapper.xml` 都是几百行的重 SQL）。

## 服务层组织套路

本项目 Service 层的稳定模式，比 [基础用法](/notes/mybatis-plus/basic-usage) 的裸 `IService` 多三层约定：

**1. 分页参数收敛进请求 DTO**。公共基类 `PageDto` 携带页码并直接产出 MP 的 `Page` 对象，Service 里不再 new：

```java
@Data
public class PageDto {
    private Integer current = 1;              // 页码，默认 1
    private Integer size = 10;                // 每页条数，传 -1 表示不分页

    @ApiIgnore // 不出现在 swagger 参数里，由子类继承使用
    public <T> Page<T> getPage() {
        return new Page<>(current, size);
    }
}
```

**2. Service 方法直接返回 `ApiResult<Page<响应DTO>>`**，套路固定为：查实体分页 → 判空短路 → 批量转 DTO → 用 id 集合二次 `in()` 查关联数据组装。避免在列表 SQL 里 join 一堆表，把 N+1 压成两次批量查询：

```java
public ApiResult<Page<QueryKsResponse>> queryKs(QueryKsRequest request) {
    Page<Ks> page = this.page(request.getPage(), ksWrapper); // 条件用 MPJ/Wrapper 拼
    List<Ks> records = page.getRecords();
    if (ObjectUtil.isEmpty(records)) return ApiResult.ok(response);

    List<QueryKsResponse> list = BeanUtil.copyToList(records, QueryKsResponse.class);
    List<Long> ids = records.stream().map(Ks::getKsId).collect(Collectors.toList());
    List<KsParts> parts = ksPartsService.list(new LambdaQueryWrapper<KsParts>()
            .in(KsParts::getKsId, ids)); // 关联表按 id 集合批量补查
    // ... 组装后回填 page.setRecords(...)
}
```

**3. 基类按需二选一**：纯单表用 `ServiceImpl<Mapper, 实体>`；要 join 就换 `MPJBaseServiceImpl<Mapper, 实体>`（它是 `ServiceImpl` 的超集，`lambdaQuery()` 等能力全保留）。接口侧统一 `extends IService<实体>` 或 MPJ 的对应接口。

另外项目利用了 MP 的枚举映射减少魔法数字：yml 配 `type-enums-package` + `default-enum-type-handler: MybatisEnumTypeHandler`，枚举字段标 `@EnumValue` 后，实体里直接声明枚举类型（如 `CustomerOpType opType`），入库取 `@EnumValue` 标注的 value，出库自动还原枚举。

## 速查小结

| 主题 | 一句话结论 / 项目做法 |
| --- | --- |
| 代码生成器 | 独立 coding-tool 模块跑 main；`f_` 前缀、产物直出 service 模块；默认 Velocity 模板，`fileOverride` 慎用 |
| 分页插件原理 | 拦截器改写 SQL：先自动 count 再拼 LIMIT |
| maxLimit / optimizeJoin | 防大页 / join 参与 count 条件时关 optimizeJoin |
| 逻辑删除生效范围 | 仅 MP 内置方法与 Wrapper；自定义 XML 手写 `deleted = 0` 且放 `ON` |
| 逻辑删除 + 唯一索引 | 联合索引带 deleted 仍会二次撞键，删除值写 id/时间戳更稳 |
| 自动填充 | `@TableField(fill)` 声明 + `MetaObjectHandler` 干活；`hasGetter` 防御；填充人取自 JWT |
| 乐观锁 | 项目未用；`@Version` + 拦截器，只护 `updateById`，冲突要自己重试 |
| Wrapper 进自定义 SQL | `@Param(Constants.WRAPPER)` + `${ew.customSqlSegment}` |
| 自定义 SQL 分页 | 首参传 `IPage` 自动 count；不准/太慢用 `countId` 或 `setSearchCount(false)` 手动 count |
| 多表查询 | 简单 join 用 MPJ（`MPJBaseMapper`/`MPJBaseServiceImpl`），重报表手写 XML |
| 服务层套路 | `PageDto.getPage()` 产分页对象；实体分页 → 转 DTO → id 集合批量补关联 |
| 枚举映射 | `type-enums-package` + `@EnumValue`，实体直接用枚举字段 |
