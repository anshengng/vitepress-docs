# MyBatis-Plus 基础用法

MyBatis-Plus（MP）在 MyBatis 之上只做增强不做改变，核心能力是为单表 CRUD 提供开箱即用的 `BaseMapper` 与 `IService`，无需写任何 SQL。本页只覆盖最基础的用法，条件构造器详见 [Wrapper 条件构造器](/notes/mybatis-plus/wrapper)。

## 引入依赖

Spring Boot 3 项目（MP 3.5.9+ 拆分了 starter）：

```xml
<dependency>
    <groupId>com.baomidou</groupId>
    <artifactId>mybatis-plus-spring-boot3-starter</artifactId>
    <version>3.5.9</version>
</dependency>
```

Spring Boot 2 项目使用 `mybatis-plus-boot-starter`。

## 最小配置

```yaml
# application.yml
mybatis-plus:
  mapper-locations: classpath*:/mapper/**/*.xml   # 自定义 XML 的位置
  configuration:
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl  # 控制台打印 SQL
    map-underscore-to-camel-case: true            # 下划线转驼峰（默认已开启）
```

启动类加 `@MapperScan("com.example.mapper")`，或在 Mapper 接口上加 `@Mapper`。

## 实体注解

```java
@Data
@TableName("sys_user")          // 表名（默认按类名驼峰转下划线推断）
public class User {
    @TableId(type = IdType.AUTO) // 主键策略：AUTO 自增 / ASSIGN_ID 雪花（默认）
    private Long id;

    private String userName;     // 自动映射 user_name

    @TableField(fill = FieldFill.INSERT) // 自动填充（需配 MetaObjectHandler）
    private LocalDateTime createTime;

    @TableField(exist = false)   // 不属于表的字段
    private String token;

    @TableLogic                  // 逻辑删除标记
    private Integer deleted;
}
```

## BaseMapper：Mapper 层用法

接口继承 `BaseMapper<T>` 即获得单表 CRUD：

```java
public interface UserMapper extends BaseMapper<User> {
}
```

常用方法：

| 方法 | 说明 |
| --- | --- |
| `int insert(T entity)` | 插入一条 |
| `int deleteById(Serializable id)` | 按主键删除（配 `@TableLogic` 则转 update） |
| `int delete(Wrapper<T> wrapper)` | 按条件删除 |
| `int updateById(T entity)` | 按主键更新（null 字段不更新） |
| `int update(T entity, Wrapper<T> wrapper)` | 按条件更新 |
| `T selectById(Serializable id)` | 主键查询 |
| `List<T> selectList(Wrapper<T> wrapper)` | 条件查询，传 `null` 查全部 |
| `T selectOne(Wrapper<T> wrapper)` | 查一条（多条会抛异常） |
| `Long selectCount(Wrapper<T> wrapper)` | 计数 |
| `<P extends IPage<T>> P selectPage(P page, Wrapper<T> wrapper)` | 分页 |

```java
// 插入
User user = new User();
user.setUserName("tom");
user.setAge(18);
userMapper.insert(user);

// 主键查询
User db = userMapper.selectById(1L);

// 条件查询（Wrapper 详见下一页）
List<User> list = userMapper.selectList(
        new LambdaQueryWrapper<User>().eq(User::getAge, 18));

// 按主键更新（null 字段被忽略）
User upd = new User();
upd.setId(1L);
upd.setAge(20);
userMapper.updateById(upd);

// 删除
userMapper.deleteById(1L);
```

## IService / ServiceImpl：Service 层用法

Service 接口继承 `IService<T>`，实现类继承 `ServiceImpl<M, T>`，在 Mapper 能力之上补充批量与链式方法：

```java
public interface UserService extends IService<User> {}

@Service
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {}
```

常用方法：

| 方法 | 说明 |
| --- | --- |
| `boolean save(T)` / `boolean saveBatch(Collection<T>)` | 单条 / 批量插入 |
| `boolean saveOrUpdate(T)` | 有主键则更新，无则插入 |
| `boolean updateById(T)` / `boolean removeById(Serializable)` | 更新 / 删除 |
| `T getById(Serializable)` / `T getOne(Wrapper<T>)` | 查询 |
| `List<T> list()` / `List<T> list(Wrapper<T>)` | 列表查询 |
| `long count()` / `long count(Wrapper<T>)` | 计数 |
| `IPage<T> page(IPage<T>, Wrapper<T>)` | 分页 |

```java
// 批量插入
userService.saveBatch(List.of(u1, u2, u3));

// 链式查询：lambdaQuery().eq(...).list()
List<User> adults = userService.lambdaQuery()
        .ge(User::getAge, 18)
        .eq(User::getStatus, 1)
        .orderByDesc(User::getCreateTime)
        .list();

// 链式更新
userService.lambdaUpdate()
        .set(User::getStatus, 0)
        .lt(User::getCreateTime, LocalDateTime.now().minusDays(30))
        .update();
```

## 分页插件

分页必须先注册拦截器，否则 `page()` 查的是全量：

```java
@Configuration
public class MybatisPlusConfig {
    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
        return interceptor;
    }
}
```

使用：

```java
Page<User> page = new Page<>(1, 10); // 页码从 1 开始，每页 10 条
IPage<User> result = userService.page(page,
        new LambdaQueryWrapper<User>().eq(User::getStatus, 1));

result.getRecords(); // 当前页数据
result.getTotal();   // 总条数
result.getPages();   // 总页数
```

## 逻辑删除

全局配置：

```yaml
mybatis-plus:
  global-config:
    db-config:
      logic-delete-field: deleted  # 实体上的逻辑删除字段
      logic-delete-value: 1        # 已删除
      logic-not-delete-value: 0    # 未删除
```

开启后所有查询自动追加 `deleted = 0`，`deleteById` 自动转为 `update ... set deleted = 1`。
