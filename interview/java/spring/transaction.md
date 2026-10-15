# Spring 事务失效场景

## 题目

> @Transactional 在哪些情况下会失效？事务传播行为了解哪些？

## 核心要点

### 常见失效场景

1. **自调用**：同类方法内部 `this.method()` 不走代理 → 事务不生效（解决：注入自身 / AopContext）
2. **方法非 public**：代理只拦截 public
3. **异常被吞**：catch 后未抛出，默认只回滚 RuntimeException/Error
4. **checked 异常**：需 `rollbackFor = Exception.class`
5. **类未被 Spring 管理** / final 方法（CGLIB 无法重写）
6. 多线程：事务上下文绑定 ThreadLocal，子线程拿不到

### 传播行为（重点三个）

- `REQUIRED`（默认）：有则加入，无则新建
- `REQUIRES_NEW`：挂起当前、新开事务（日志记录场景）
- `NESTED`：基于 savepoint 的部分回滚

## 面试答法

（待补充：组织 30 秒版本 + 深入版本）
