# Wrapper 条件构造器

Wrapper 是 MP 构造 SQL `WHERE` 条件的工具，所有单表条件查询/更新/删除都围绕它展开。本页覆盖最常用的语法形态。

## 家族总览

| 类 | 用途 | 列名写法 |
| --- | --- | --- |
| `QueryWrapper<T>` | 查询条件 | 字符串列名 |
| `LambdaQueryWrapper<T>` | 查询条件 | 方法引用（类型安全） |
| `UpdateWrapper<T>` | 更新条件 + set | 字符串列名 |
| `LambdaUpdateWrapper<T>` | 更新条件 + set | 方法引用 |

推荐一律使用 **Lambda 版本**：列名写错在编译期就会报错，重构改名也能自动跟随。

## 两种调用风格：传 Wrapper vs 链式

本质：**链式只是语法糖**。`lambdaQuery()` 内部 new 一个 `LambdaQueryWrapper`，条件方法完全相同，只是把「终点」从 `mapper.selectXxx(wrapper)` 变成了链尾的 `.list()` / `.one()` / `.update()`。条件写法可以无缝互换。

下面每个场景左右对照：

### 查询列表

```java
// 传 Wrapper：new（或 Wrappers 工厂）+ mapper
List<User> users = userMapper.selectList(
        new LambdaQueryWrapper<User>()
                .ge(User::getAge, 18)
                .eq(User::getStatus, 1)
                .orderByDesc(User::getCreateTime));

// 链式：Service 入口 + 链尾 list()
List<User> users = userService.lambdaQuery()
        .ge(User::getAge, 18)
        .eq(User::getStatus, 1)
        .orderByDesc(User::getCreateTime)
        .list();
```

### 查询一条

```java
// 传 Wrapper
User user = userMapper.selectOne(
        new LambdaQueryWrapper<User>().eq(User::getUserName, "tom"));

// 链式（命中多条会抛异常）
User user = userService.lambdaQuery()
        .eq(User::getUserName, "tom")
        .one();

// 链式（命中多条取第一条并打日志）
Optional<User> opt = userService.lambdaQuery()
        .eq(User::getUserName, "tom")
        .last("LIMIT 1")
        .oneOpt();
```

### 计数与存在性判断

```java
// 传 Wrapper
Long count = userMapper.selectCount(
        new LambdaQueryWrapper<User>().eq(User::getStatus, 1));

// 链式
long count = userService.lambdaQuery().eq(User::getStatus, 1).count();

// 只判断有没有数据：exists 比 count 更省（SQL 带 LIMIT 1）
boolean exists = userService.lambdaQuery().eq(User::getUserName, "tom").exists();
```

### 分页查询

```java
// 传 Wrapper
Page<User> page = userMapper.selectPage(new Page<>(1, 10),
        new LambdaQueryWrapper<User>().eq(User::getStatus, 1));

// 链式
IPage<User> page = userService.lambdaQuery()
        .eq(User::getStatus, 1)
        .page(new Page<>(1, 10));
```

### 查询返回 Map / 单列

```java
// 传 Wrapper：selectMaps 返回 List<Map<String,Object>>
List<Map<String, Object>> maps = userMapper.selectMaps(
        new QueryWrapper<User>().select("dept_id, COUNT(*) AS cnt").groupBy("dept_id"));

// 链式
List<Map<String, Object>> maps = userService.query()
        .select("dept_id, COUNT(*) AS cnt")
        .groupBy("dept_id")
        .listMaps();

// 只取第一列
List<Object> names = userMapper.selectObjs(
        new QueryWrapper<User>().select("user_name").eq("status", 1));

List<Object> names = userService.query()
        .select("user_name")
        .eq("status", 1)
        .listObjs();
```

### 条件更新

```java
// 传 Wrapper：实体给值 + Wrapper 给条件（null 字段被忽略）
User upd = new User();
upd.setStatus(0);
userService.update(upd,
        new LambdaQueryWrapper<User>().eq(User::getId, 1L));

// 链式：set 显式指定列（可以把字段更新为 null）
userService.lambdaUpdate()
        .set(User::getStatus, 0)
        .set(User::getRemark, null)
        .eq(User::getId, 1L)
        .update();
```

### 条件删除

```java
// 传 Wrapper
userMapper.delete(
        new LambdaQueryWrapper<User>().lt(User::getCreateTime, threshold));

// 链式
userService.lambdaUpdate()
        .lt(User::getCreateTime, threshold)
        .remove();
```

### 场景速查表

| 操作 | 传 Wrapper（mapper/service） | 链式（service） |
| --- | --- | --- |
| 查列表 | `selectList(wrapper)` / `list(wrapper)` | `.list()` |
| 查一条 | `selectOne(wrapper)` / `getOne(wrapper)` | `.one()` / `.oneOpt()` |
| 计数 | `selectCount(wrapper)` / `count(wrapper)` | `.count()` |
| 存在性 | `selectCount(wrapper) > 0` | `.exists()` |
| 分页 | `selectPage(page, wrapper)` / `page(page, wrapper)` | `.page(page)` |
| 返回 Map | `selectMaps(wrapper)` | `.listMaps()` |
| 返回单列 | `selectObjs(wrapper)` | `.listObjs()` |
| 条件更新 | `update(entity, wrapper)` | `.set().update()` |
| 条件删除 | `delete(wrapper)` / `remove(wrapper)` | `.remove()` |

## 链式入口：不止 lambdaQuery()

### IService 的四个入口

| 入口 | 链类型 | 列名写法 |
| --- | --- | --- |
| `lambdaQuery()` | `ChainQuery<T>` | 方法引用 |
| `query()` | `QueryChainWrapper<T>` | 字符串列名 |
| `lambdaUpdate()` | `ChainUpdate<T>` | 方法引用 |
| `update()` | `UpdateChainWrapper<T>` | 字符串列名 |

### ChainWrappers：没有 Service 也能链式

只注入了 Mapper 时，用 `ChainWrappers` 包一层即可链式：

```java
import com.baomidou.mybatisplus.extension.toolkit.ChainWrappers;

List<User> users = ChainWrappers.lambdaQueryChain(userMapper)
        .eq(User::getStatus, 1)
        .list();

ChainWrappers.lambdaUpdateChain(userMapper)
        .set(User::getStatus, 0)
        .eq(User::getId, 1L)
        .update();
```

### Db 静态门面（3.5.0+）

连 Service 实现类都不用写，直接传实体类：

```java
import com.baomidou.mybatisplus.extension.toolkit.Db;

List<User> users = Db.lambdaQuery(User.class)
        .eq(User::getStatus, 1)
        .list();

Db.saveBatch(users);
Db.remove(User.class, Wrappers.<User>lambdaQuery().eq(User::getStatus, 0));
```

> `Db` 内部依赖 `SqlRunner`/全局注册表找到对应 Mapper，实体必须已被 `@MapperScan` 覆盖。

### Wrappers 工厂（不是链式，只是构造入口）

```java
import com.baomidou.mybatisplus.core.toolkit.Wrappers;

Wrappers.<User>lambdaQuery()   // LambdaQueryWrapper
Wrappers.<User>query()         // QueryWrapper
Wrappers.<User>lambdaUpdate()  // LambdaUpdateWrapper
Wrappers.<User>update()        // UpdateWrapper
Wrappers.emptyQuery()          // 空条件
```

### Active Record 模式

实体继承 `Model<T>` 后，对象自己就能 CRUD（适合简单场景，业务复杂不推荐）：

```java
public class User extends Model<User> {}

new User().setId(1L).selectById();                       // 查询
new User().selectList(Wrappers.<User>lambdaQuery().eq("status", 1)); // 列表
user.insert(); user.updateById(); user.deleteById();     // 增删改
```

## 链式终点方法一览

**查询链（ChainQuery / QueryChainWrapper）终点：**

| 终点 | 返回 | 说明 |
| --- | --- | --- |
| `.list()` | `List<T>` | 查询列表 |
| `.one()` | `T` | 查一条，多条抛异常 |
| `.oneOpt()` | `Optional<T>` | 同上，包成 Optional |
| `.count()` | `long` | 计数 |
| `.exists()` | `boolean` | 是否存在（LIMIT 1） |
| `.page(page)` | `IPage<T>` | 分页 |
| `.listMaps()` | `List<Map>` | 结果转 Map（适合聚合列） |
| `.listObjs()` | `List<Object>` | 只取第一列 |

**更新链（ChainUpdate / UpdateChainWrapper）终点：**

| 终点 | 说明 |
| --- | --- |
| `.update()` | 执行条件更新（需先 `set()` 或用实体） |
| `.remove()` | 执行条件删除 |

## 常用条件方法

以下方法在 QueryWrapper / LambdaQueryWrapper 中通用（链式与传参写法完全一致）：

| 方法 | 生成 SQL |
| --- | --- |
| `eq(col, val)` | `col = val` |
| `ne(col, val)` | `col <> val` |
| `gt / ge / lt / le` | `>` `>=` `<` `<=` |
| `between(col, a, b)` | `col BETWEEN a AND b` |
| `like(col, val)` | `col LIKE '%val%'` |
| `likeLeft / likeRight` | `'%val'` / `'val%'` |
| `in(col, coll)` | `col IN (...)` |
| `isNull / isNotNull(col)` | `col IS NULL` 等 |
| `groupBy(col)` | `GROUP BY ...` |
| `having(...)` | `HAVING ...` |
| `orderByAsc / orderByDesc(col)` | `ORDER BY ...` |
| `select(User::getId, User::getName)` | 只查指定列 |
| `last("LIMIT 1")` | 拼接在 SQL 末尾 |

组合示例：

```java
userService.lambdaQuery()
        .select(User::getId, User::getUserName)   // 只查 id、name
        .eq(User::getStatus, 1)
        .like(User::getUserName, "张")            // name LIKE '%张%'
        .ge(User::getAge, 18)
        .in(User::getDeptId, List.of(1, 2, 3))
        .orderByDesc(User::getCreateTime)
        .last("LIMIT 10")
        .list();
```

## 动态条件：第一个 boolean 参数

每个条件方法都有 `(boolean condition, col, val)` 重载，`condition` 为 `false` 时该子句被跳过，非常适合可选筛选：

```java
// 传统写法：一堆 if
LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<>();
if (query.getName() != null) {
    wrapper.like(User::getUserName, query.getName());
}
if (query.getMinAge() != null) {
    wrapper.ge(User::getAge, query.getMinAge());
}

// 简化写法：利用 condition 参数
userService.lambdaQuery()
        .like(StringUtils.isNotBlank(query.getName()), User::getUserName, query.getName())
        .ge(query.getMinAge() != null, User::getAge, query.getMinAge())
        .list();
```

## and / or 与嵌套

默认所有条件以 `AND` 连接。需要 `OR` 或括号嵌套时用 `and()` / `or()`：

```java
// WHERE status = 1 AND (name LIKE '%张%' OR age > 60)
userService.lambdaQuery()
        .eq(User::getStatus, 1)
        .and(w -> w.like(User::getUserName, "张")
                   .or()
                   .gt(User::getAge, 60))
        .list();
```

`or()` 之后直接追加条件表示 `A OR B`；`and(consumer)` 生成 `( ... )` 括号块。

## 速记口诀

- 两种风格等价：条件写法相同，只是入口（`new Wrapper` vs `lambdaQuery()`）和终点（`mapper.selectXxx` vs `.list()`）不同
- 查询链终点：`list / one / oneOpt / count / exists / page / listMaps / listObjs`
- 更新链终点：`set().update()` 与 `remove()`
- 动态条件：把判空写进第一个 boolean 参数
- 复杂逻辑：`and(w -> ...)` 嵌套出括号
