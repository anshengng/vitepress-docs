# 前端工程化常识

## 题目

> Git 里 merge 和 rebase 怎么选？误删的提交怎么救回？cherry-pick 和 revert 有什么区别？npm、yarn、pnpm 安装出来的 node_modules 有什么不一样，幽灵依赖是什么？pnpm 为什么又快又省磁盘？lockfile 冲突了怎么办？ESLint 和 Prettier 谁管什么？Husky + lint-staged + commitlint 是怎么串起来的？qiankun、wujie、模块联邦各是什么原理、适合什么场景？

## 为什么需要

工程化不是"背名词"，而是回答一个问题：**多人协作 + 长期迭代的项目，怎么保证代码不出错、依赖不炸、风格统一、架构能拆得动**。面试问工程化，考的是你有没有真正在团队项目里干过活：

- Git 操作 → 团队协作的底线（合并策略、救火能力）
- 包管理 → 依赖地狱的现实（幽灵依赖、锁文件冲突）
- 代码质量工具链 → 把规范变成机器强制执行的流程
- 微前端 → 大型应用拆分与多团队自治的方案取舍

## 核心要点

### 1. Git 高频操作

#### merge vs rebase

```
初始状态：
  main:     A---B---C
  feature:       D---E        （从 B 拉出，两边各自有新提交）

── merge（保留真实历史，多一个合并提交 M）──
  main:     A---B---C-------M
                 \         /
  feature:        D---E---

── rebase（改写历史，变出一条直线）──
  main:     A---B---C
                     \
                      D'--E'   （D/E 被"重放"到 C 之后，hash 全变了）
```

| 维度 | merge | rebase |
| --- | --- | --- |
| 历史形态 | 保留分叉，真实但杂乱 | 线性、干净 |
| 是否改写历史 | 否 | **是**（commit hash 变化） |
| 安全性 | 公共分支随便用 | **只 rebase 本地未推送的分支**，公共分支上 rebase 会让别人崩溃 |
| 典型用法 | `git merge dev` 合入主干 | `git pull --rebase` / `git rebase main` 同步主干后再提 MR |

一句话答法：**用 rebase 同步（让自己的提交排在主干后面，保持线性），用 merge 合入（保留特性分支的完整上下文）；已推送的公共分支绝不 rebase。**

#### 冲突解决流程

```
git merge dev
   └─► CONFLICT (content): Merge conflict in src/app.js

1. git status            ← 看哪些文件冲突（both modified）
2. 打开冲突文件，处理标记：
   <<<<<<< HEAD
   当前分支的内容
   =======
   dev 分支的内容
   >>>>>>> dev
   手工挑选/融合 → 删掉三行标记
3. git add src/app.js    ← add 即"标记已解决"（不是 commit）
4. git commit            ← merge 冲突：完成合并提交
   或 git rebase --continue ← rebase 冲突：重放下一个提交
   反悔 anytime：git merge --abort / git rebase --abort 回到冲突前
```

#### reflog 救回丢失提交

`git reflog` 记录的是 **HEAD 的移动轨迹**（本地一般保留 90 天），只要提交曾经存在过，hash 就在里面：

```
$ git reflog
3f8a2b1 HEAD@{0}: reset: moving to HEAD~2   ← 手滑 reset --hard 把提交"丢了"
9c4d7e8 HEAD@{1}: commit: 写完支付回调
b2e5f1a HEAD@{2}: commit: 加了签名工具函数
3f8a2b1 HEAD@{3}: commit: 上一个正常提交

$ git reset --hard 9c4d7e8     ← 直接回到丢失时的状态
$ 或 git cherry-pick 9c4d7e8   ← 只把某个丢失提交捞回当前分支
```

同理：误删分支后 `git reflog` 找到该分支最后的提交 hash，再 `git branch dev <hash>` 重建。**口诀：只要 hash 还活着，提交就还活着。**

#### cherry-pick vs revert

| | cherry-pick | revert |
| --- | --- | --- |
| 干什么 | 把**别的分支**的某个提交"复制"一份应用到当前分支 | 在**当前分支**生成一个反向提交，抵消某个已提交的改动 |
| 历史 | 新增提交（hash 变了，作者信息保留） | 新增一个"撤销提交"，原提交仍在历史里 |
| 场景 | 把 hotfix 分支的修复同步到 release 分支 | 线上刚发的坏提交需要安全回滚 |
| 公共分支安全吗 | 是（只是加提交） | 是（**永远不要用 `reset --hard` + 强推回滚公共分支**） |

#### Conventional Commits 提交规范

```
<type>(<scope>): <subject>      ← 尖括号是格式占位符，实际书写不带
feat(payment): 支持支付宝分账
fix(cart): 修复数量输入框负数未拦截
```

常用 type：`feat`（新功能）、`fix`（修 bug）、`docs`、`style`（格式不动逻辑）、`refactor`、`perf`、`test`、`chore`（构建/杂务）。破坏性变更加 `BREAKING CHANGE:` 脚注。

价值：① 人读历史一眼定位；② 工具链消费——commitlint 校验、standard-version 自动生成 CHANGELOG、按 type 决定语义化版本号。

### 2. 包管理：npm / yarn / pnpm

#### 依赖结构对比

```
npm/yarn v1（扁平提升 hoisting）：          pnpm（非扁平，.pnpm 仓库）：
node_modules/                              node_modules/
├── lodash/        ← A 依赖的             ├── axios/    →(符号链接) 指向 .pnpm 里
├── axios/                                  ├── vue/      →(符号链接)
└── follow-redirects/ ← 本应只在 axios 内，  └── .pnpm/    ← 真正的物理存放
    却被提升到顶层！B 没装它也能 import
```

| 维度 | npm | yarn (v1) | pnpm |
| --- | --- | --- | --- |
| node_modules 结构 | 扁平提升 | 扁平提升 | 非扁平，符号链接 + `.pnpm` 虚拟仓库 |
| 幽灵依赖 | 有 | 有 | **无**（访问不到未声明的包） |
| 磁盘占用 | 每个项目各存一份 | 同左 | **硬链接共享全局 store，一份文件多项目复用** |
| 安装速度 | 慢 | 中 | 快（可并行 + 命中 store 免下载） |
| lockfile | package-lock.json | yarn.lock | pnpm-lock.yaml |

**幽灵依赖**：扁平结构里，传递依赖被提升到顶层，于是代码里能 `import _ from 'lodash'`，而它根本没写进 package.json。npm 里"碰巧能用"，换到 pnpm 立刻报错——**修复方式就是把它显式加进 dependencies**。

#### pnpm 原理（硬链接 + 符号链接）

```
全局 store（~/.pnpm-store，每个包只存一份真实文件）
        ▲ 硬链接（同一磁盘，两个路径指向同一份数据，不占双倍空间）
        │
项目/node_modules/.pnpm/
├── lodash@4.17.21/node_modules/lodash/      ← 硬链接到 store
├── axios@1.6.0/node_modules/
│   ├── axios/                               ← 硬链接
│   └── follow-redirects → 指向 .pnpm 内自己那份  ← 符号链接
│
项目/node_modules/
├── vue    → .pnpm/vue@3.4.0/node_modules/vue   ← 符号链接（顶层只放你声明过的直接依赖）
└── axios  → .pnpm/axios@1.6.0/node_modules/axios
```

三个角色：
- **硬链接**：把包文件从全局 store"接"进 `.pnpm` 目录，磁盘上只存一份 → 省空间；第二次装同版本零下载 → 快。
- **符号链接**：顶层 `node_modules/xxx` 只是指针，指向 `.pnpm` 里的真实目录 → 顶层干净，未声明的包访问不到 → 消灭幽灵依赖。
- **`.pnpm` 目录**：每个包连同"它自己声明的依赖"组成独立小宇宙，天然支持严格版本隔离（同一依赖的不同版本可以共存）。

#### lockfile 的作用与冲突处理

作用：package.json 写的是 `^1.2.3` 这种范围，lockfile 把**整棵依赖树的精确版本 + integrity 哈希**钉死，保证所有人、所有 CI 装出来的树一模一样，且能校验包内容未被篡改。

冲突处理原则：**lockfile 是生成物，不是手写物。**

```
1. 不要手工解决 lock 里的冲突标记（容易改出坏哈希）
2. 推荐流程：先解决 package.json 的冲突 → 删掉 lock 重新生成
   npm:  rm package-lock.json && npm install
   pnpm: rm pnpm-lock.yaml && pnpm install
   （或安装时加 --no-frozen-lockfile 允许更新 lock）
3. 团队/CI 统一工具：package.json 里写 "packageManager": "pnpm@9.x"，
   CI 用 pnpm install --frozen-lockfile 校验 lock 与 package.json 一致
4. 混用 npm 和 pnpm 会产生两份 lock、结构互不兼容 → 全项目只用一个工具
```

### 3. 代码质量：ESLint / Prettier / 提交链路

#### ESLint vs Prettier 分工

| | ESLint | Prettier |
| --- | --- | --- |
| 管什么 | **代码质量**：未定义变量、可能出错的写法、最佳实践（基于 AST 静态分析） | **代码格式**：缩进、换行、引号、分号（只管长得对不对，不管逻辑对不对） |
| 能否自动修 | 部分规则可 `--fix` | 全部可自动 |
| 重叠区 | 格式类规则（如 quotes、semi） | 同左 |

协作方式：用 `eslint-config-prettier` **关掉 ESLint 里所有格式类规则**，格式全部交给 Prettier，避免两个工具互相打架（保存时 Prettier 格式化完，ESLint 又报一堆格式错）。

#### Husky + lint-staged + commitlint 提交链路

```
git commit -m "feat(cart): 加购物车"
      │
      ▼
Husky 拦截 git 钩子（pre-commit）
      │
      ▼
lint-staged：只取 git add 过的文件（暂存区），不全量扫描
      ├─► prettier --write   （格式化）
      └─► eslint --fix       （质量检查 + 自动修复）
      │
      ├─ 任一失败 ──► 中止提交，代码不会进历史
      ▼ 通过
git 生成提交 → Husky 拦截 commit-msg 钩子
      │
      ▼
commitlint 校验提交信息是否符合 Conventional Commits
      │
      ├─ 不符合（如 "随便写写"）──► 中止提交
      ▼ 符合
提交成功 ✓
```

各角色一句话：**Husky 是"钩子管家"**（把校验脚本挂到 git 流程上）；**lint-staged 是"范围缩小器"**（只检查改动文件，快）；**commitlint 是"文案质检员"**（管 message 格式）。

### 4. 微前端一句话对比

| 方案 | 核心原理 | 适用场景 | 主要代价 |
| --- | --- | --- | --- |
| qiankun | 基于 `import-html-entry` 拉取子应用 HTML/JS，JS 沙箱（Proxy 代理 window）+ 样式隔离，主应用按路由挂载子应用 | 多技术栈共存的老系统聚合门户 | 子应用必须导出生命周期；JS 沙箱有性能损耗；样式隔离非 100% |
| wujie | **iframe 提供 JS 隔离 + Web Components 提供 DOM/样式渲染**，主应用把子应用渲染进自定义元素，props 通信 | 强隔离需求、接入不可控的第三方/遗留应用 | 每个子应用一个 iframe 环境，内存开销大 |
| Module Federation（Webpack5 / Vite 插件） | 构建时把应用声明为 remote，**运行时**宿主按需远程加载对方的模块并共享依赖（如共用同一份 Vue/React 实例） | 同一技术栈团队间的组件级复用，不想引入运行时框架 | 依赖构建工具支持；共享依赖的版本与类型要团队间约定，调试跨应用链路复杂 |

一句话：**qiankun 管"整个应用"的集成，wujie 用 iframe 换隔离度，模块联邦管"模块/组件"级的运行时共享。**

## 面试答法

### 30 秒版本

工程化四件事：**Git** 上，同步主干用 rebase 保持线性、合入主干用 merge 保留历史，公共分支不 rebase，丢提交靠 reflog 找回，回滚公共分支用 revert；**包管理**上，npm/yarn 扁平安装带来幽灵依赖，pnpm 用"硬链接到全局 store + 符号链接组织目录"做到既省磁盘又严格，lockfile 把整棵依赖树版本钉死，冲突时删掉重新生成而不是手工解；**质量**上，ESLint 管代码质量、Prettier 管格式，Husky 在 pre-commit 跑 lint-staged、在 commit-msg 跑 commitlint，把规范变成提交前的强制关卡；**架构**上，微前端三选一：qiankun 路由级集成、wujie 用 iframe+Web Components 换强隔离、模块联邦做同技术栈的运行时共享。

### 深入展开

1. **Git**：先画 merge/rebase 的分叉图讲清"改写历史"的含义，再落到团队约定（MR 前 rebase 同步、主干上只 merge）；展示救火能力时用 reflog 的时间线（reset 丢了提交 → reflog 找 hash → reset --hard / cherry-pick 捞回）。
2. **pnpm**：按"store → .pnpm 硬链接 → 顶层符号链接"三层讲，把幽灵依赖作为对比 npm 的关键差异点；最后补 lockfile 与 `packageManager` 字段，体现工程落地。
3. **工具链**：画 pre-commit → lint-staged → commit-msg → commitlint 的链路图，强调 lint-staged 只检查暂存文件的性能意义。
4. **微前端**：不要背名词，按"隔离方式"和"共享粒度"两个轴定位三个方案，再各说一个代价。

### 常见追问 Q/A

- **为什么公共分支不能 rebase？** → rebase 重放提交会改变 hash，别人本地还基于旧提交；再推送就需要强推，直接覆盖别人的历史。公共分支要"回滚"请用 revert。
- **`git reset --hard` 和 `git revert` 都能回滚，区别？** → reset 是把分支指针移走、抹掉历史（本地未推送可用）；revert 是新增反向提交、历史完整保留（公共分支唯一安全选项）。
- **pnpm 的硬链接和符号链接分别解决什么？** → 硬链接解决"磁盘只存一份、安装免下载"；符号链接解决"顶层只暴露声明过的依赖"，即严格性与幽灵依赖。
- **幽灵依赖怎么产生的、怎么修？** → 扁平提升让未声明的包可被访问到；修法是把它写进 package.json，或换 pnpm 直接暴露问题。
- **为什么 lockfile 冲突不建议手工解？** → 手工拼接容易改出错误的 integrity 哈希导致安装校验失败；正确做法是解 package.json 冲突后删除 lock 重新生成，CI 用 frozen-lockfile 校验一致性。
- **ESLint 能不能完全替代 Prettier？** → 理论上能管格式，但规则零散、修复不彻底且团队配置成本高；社区共识是格式全交 Prettier，ESLint 专注质量规则。
- **qiankun 的 JS 沙箱大概怎么实现的？** → 用 Proxy 代理一个 fake window，子应用的全局变量写进代理对象，卸载时丢弃，从而模拟隔离（快照沙箱是降级方案）。
- **微前端一定要上吗？** → 单体或模块联邦能解决的组件复用，别上重型方案；微前端的收益是多团队自治，代价是复杂度、性能、心智负担，按组织问题而不是技术问题来决策。
