import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '技术面试知识库',
  description: 'Vue / React 底层原理、前端基础面试题与 Java 后端高频考点',
  // GitHub Pages 项目站地址为 https://anshengng.github.io/vitepress-docs/，base 必须等于仓库名
  base: '/vitepress-docs/',
  // 忽略 README/QUICKSTART 中的本地开发示例地址
  ignoreDeadLinks: [/localhost:5173/],

  // 主题配置
  themeConfig: {
    // 侧边栏
    sidebar: [
      {
        text: 'Vue 底层',
        collapsed: false,
        items: [
          {
            text: '基础与实战',
            collapsed: false,
            items: [
              { text: 'Arco Design 配置', link: '/vue/basics/arco-config' },
              { text: '实例与应用：Vue2 vs Vue3', link: '/vue/basics/instance-vs-app' },
              { text: '事件处理', link: '/vue/basics/event-handling' },
              { text: 'Promise 弹窗方案', link: '/vue/dialogs/promise-dialog' },
              { text: 'createDialog 工厂', link: '/vue/dialogs/create-dialog' },
              { text: '命令式组件调用', link: '/vue/dialogs/imperative-dialog' }
            ]
          },
          {
            text: '响应式系统',
            collapsed: false,
            items: [
              { text: '响应式系统核心', link: '/vue/reactivity/reactivity' },
              { text: 'Vue2 vs Vue3 响应式', link: '/vue/reactivity/vue2-vs-vue3' },
              { text: 'computed 与 watch', link: '/vue/reactivity/computed-watch' },
              { text: '浅层 API 与性能优化', link: '/vue/reactivity/shallow-api' },
              { text: '手写响应式（完整版）', link: '/vue/handwritten/mini-reactivity' }
            ]
          },
          {
            text: '编译与渲染',
            collapsed: false,
            items: [
              { text: '编译流程', link: '/vue/compiler/compile-flow' },
              { text: '指令编译', link: '/vue/compiler/directive-compile' },
              { text: '代码生成', link: '/vue/compiler/codegen' },
              { text: 'SFC 编译', link: '/vue/compiler/sfc-compile' },
              { text: '编译优化', link: '/vue/compiler/compile-optimization' },
              { text: 'render 和 h 函数', link: '/vue/rendering/render-and-h' },
              { text: '应用挂载与组件挂载流程', link: '/vue/rendering/mount-flow' },
              { text: '虚拟 DOM', link: '/vue/rendering/virtual-dom' },
              { text: 'Diff 算法与 key', link: '/vue/rendering/diff-key' },
              { text: 'nextTick 与异步更新', link: '/vue/rendering/next-tick' }
            ]
          },
          {
            text: '组件系统',
            collapsed: false,
            items: [
              { text: '组件系统', link: '/vue/components/component-system' },
              { text: '组件的本质形态', link: '/vue/components/component-essence' },
              { text: 'v-model 原理', link: '/vue/components/v-model' },
              { text: 'keep-alive 原理', link: '/vue/components/keep-alive' },
              { text: '函数式组件', link: '/vue/components/functional-component' },
              { text: '生命周期', link: '/vue/components/lifecycle' },
              { text: 'provide / inject', link: '/vue/components/provide-inject' },
              { text: '插槽 slot', link: '/vue/components/slot' },
              { text: 'Teleport 传送门', link: '/vue/components/teleport' },
              { text: '异步组件', link: '/vue/components/async-component' }
            ]
          },
          {
            text: '高级话题',
            collapsed: false,
            items: [
              { text: '运行时架构', link: '/vue/advanced/runtime-architecture' },
              { text: '组合式 API', link: '/vue/advanced/composition-api' },
              { text: '自定义渲染器', link: '/vue/advanced/custom-renderer' },
              { text: '自定义指令', link: '/vue/advanced/custom-directive' },
              { text: '模板 ref', link: '/vue/advanced/template-ref' },
              { text: '动态组件', link: '/vue/advanced/dynamic-component' },
              { text: '过渡与动画', link: '/vue/advanced/transition' },
              { text: 'Vue Router', link: '/vue/advanced/router' },
              { text: 'Pinia 状态管理', link: '/vue/advanced/pinia' },
              { text: 'SSR 与水合', link: '/vue/advanced/ssr' }
            ]
          },
          {
            text: '框架对比',
            collapsed: false,
            items: [
              { text: 'Vue vs React', link: '/compare/vue-vs-react' }
            ]
          }
        ]
      },
      {
        text: 'React 底层',
        collapsed: false,
        items: [
          { text: 'React 原理总览', link: '/react/' },
          {
            text: 'JSX 与 Element',
            collapsed: false,
            items: [
              { text: 'JSX 本质与编译', link: '/react/jsx/jsx-compile' },
              { text: 'Element 与 Fiber', link: '/react/jsx/element-vs-fiber' }
            ]
          },
          {
            text: 'Fiber 架构',
            collapsed: false,
            items: [
              { text: '为什么要 Fiber', link: '/react/fiber/why-fiber' },
              { text: '双缓冲与两阶段', link: '/react/fiber/double-buffer' },
              { text: '协调与 Diff', link: '/react/fiber/reconcile-diff' }
            ]
          },
          {
            text: 'Hooks 原理',
            collapsed: false,
            items: [
              { text: 'Hooks 链表', link: '/react/hooks/hooks-link' },
              { text: 'useState 与更新队列', link: '/react/hooks/usestate-queue' },
              { text: 'useEffect 与 useMemo', link: '/react/hooks/effect-and-memo' },
              { text: '手写简化版 Hooks', link: '/react/hooks/handwritten-hooks' }
            ]
          },
          {
            text: '调度与并发',
            collapsed: false,
            items: [
              { text: 'Scheduler 与时间切片', link: '/react/scheduler/scheduler-slice' },
              { text: 'Lane 优先级模型', link: '/react/scheduler/lane-model' },
              { text: '并发特性', link: '/react/scheduler/concurrent' },
              { text: 'Suspense 原理', link: '/react/scheduler/suspense' }
            ]
          },
          {
            text: '事件系统',
            collapsed: false,
            items: [
              { text: '合成事件', link: '/react/events/synthetic-event' }
            ]
          },
          {
            text: 'Context 与 Ref',
            collapsed: false,
            items: [
              { text: 'Context 原理', link: '/react/context/context' },
              { text: 'Ref 体系', link: '/react/ref/ref-system' }
            ]
          },
          {
            text: '渲染与表单',
            collapsed: false,
            items: [
              { text: 'Portals', link: '/react/render/portals' },
              { text: '受控与非受控组件', link: '/react/forms/controlled-uncontrolled' }
            ]
          },
          {
            text: '优化与生命周期',
            collapsed: false,
            items: [
              { text: 'memo 与 PureComponent', link: '/react/optimization/memo-purecomponent' },
              { text: '错误边界', link: '/react/optimization/error-boundary' },
              { text: '类组件生命周期', link: '/react/lifecycle/class-lifecycle' }
            ]
          },
          {
            text: '状态管理与路由',
            collapsed: false,
            items: [
              { text: '状态管理方案', link: '/react/state/state-management' },
              { text: 'React Router', link: '/react/ecosystem/router' }
            ]
          },
          {
            text: '现代特性与 SSR',
            collapsed: false,
            items: [
              { text: 'React 18 新 Hooks', link: '/react/modern/react18-hooks' },
              { text: 'React 19 新特性', link: '/react/modern/react19' },
              { text: 'SSR 与水合', link: '/react/ssr/ssr-hydration' }
            ]
          },
          {
            text: '手写实现',
            collapsed: false,
            items: [
              { text: '手写 mini-react', link: '/react/handwritten/mini-react' }
            ]
          }
        ]
      },
      {
        text: '前端基础',
        collapsed: false,
        items: [
          {
            text: 'JS 语言核心',
            collapsed: true,
            items: [
              { text: '类型转换与隐式转换', link: '/interview/frontend-basics/types-coercion' },
              { text: 'var / let / const 的区别', link: '/interview/frontend-basics/var-let-const' },
              { text: '原型链与继承', link: '/interview/frontend-basics/prototype-chain' },
              { text: '闭包与 this 指向', link: '/interview/frontend-basics/closure-this' },
              { text: '箭头函数', link: '/interview/frontend-basics/arrow-function' },
              { text: '函数参数与 arguments', link: '/interview/frontend-basics/function-arguments' },
              { text: 'filter 与 map', link: '/interview/frontend-basics/array-filter-map' },
              { text: 'split / splice / slice', link: '/interview/frontend-basics/split-splice-slice' },
              { text: 'JSON.parse 与 JSON.stringify', link: '/interview/frontend-basics/json-api' },
              { text: '深拷贝与浅拷贝', link: '/interview/frontend-basics/deep-copy' },
              { text: '副作用', link: '/interview/frontend-basics/side-effects' },
              { text: '垃圾回收机制', link: '/interview/frontend-basics/garbage-collection' },
              { text: 'JS 实现封装、继承、多态', link: '/interview/frontend-basics/oop-js' },
              { text: 'Promise 与 async/await', link: '/interview/frontend-basics/promise-async' },
              { text: '事件循环（Event Loop）', link: '/interview/frontend-basics/event-loop' },
              { text: '防抖与节流', link: '/interview/frontend-basics/debounce-throttle' },
              { text: '大数阶乘（1×2×…×100w）', link: '/interview/frontend-basics/big-number-factorial' }
            ]
          },
          {
            text: '手写题与算法',
            collapsed: true,
            items: [
              { text: 'JS 高频手写题', link: '/interview/frontend-basics/js-handwriting' },
              { text: '高频手写题进阶（二）', link: '/interview/frontend-basics/js-handwriting-2' },
              { text: '前端手写算法模板', link: '/interview/frontend-basics/algorithms' }
            ]
          },
          {
            text: 'TypeScript',
            collapsed: true,
            items: [
              { text: 'TypeScript 面试要点', link: '/interview/frontend-basics/typescript' },
              { text: 'TS 与 JS 数据类型', link: '/interview/frontend-basics/ts-vs-js-types' },
              { text: 'TS 泛型与函数重载', link: '/interview/frontend-basics/ts-generics-overload' },
              { text: 'TS 工具类型（Partial/Pick/Omit）', link: '/interview/frontend-basics/ts-utility-types' }
            ]
          },
          {
            text: 'CSS 与 HTML',
            collapsed: true,
            items: [
              { text: 'CSS 居中与隐藏元素', link: '/interview/frontend-basics/css-center-hide' },
              { text: '清除浮动、BFC 与响应式', link: '/interview/frontend-basics/bfc-float-responsive' },
              { text: 'img 的 alt/title 与 HTML 语义', link: '/interview/frontend-basics/img-alt-title' },
              { text: 'Tailwind CSS', link: '/interview/frontend-basics/tailwind' }
            ]
          },
          {
            text: '浏览器与性能',
            collapsed: true,
            items: [
              { text: '浏览器渲染原理', link: '/interview/frontend-basics/browser-render' },
              { text: '事件冒泡与事件委托', link: '/interview/frontend-basics/event-delegation' },
              { text: 'onclick 与 addEventListener', link: '/interview/frontend-basics/onclick-vs-addeventlistener' },
              { text: '从输入 URL 到页面展示', link: '/interview/frontend-basics/url-to-page' },
              { text: 'async / defer / prefetch / preload', link: '/interview/frontend-basics/resource-hints' },
              { text: '浏览器存储（Cookie/Storage）', link: '/interview/frontend-basics/storage-apis' },
              { text: '页面间通信方式', link: '/interview/frontend-basics/cross-page-communication' },
              { text: '文件压缩方案', link: '/interview/frontend-basics/file-compression' },
              { text: 'Web 性能优化', link: '/interview/frontend-basics/performance-optimization' }
            ]
          },
          {
            text: '网络与安全',
            collapsed: true,
            items: [
              { text: 'GET 与 POST 的区别', link: '/interview/frontend-basics/http-get-post' },
              { text: 'HTTP 状态码', link: '/interview/frontend-basics/http-status-codes' },
              { text: '常用 HTTP 请求头', link: '/interview/frontend-basics/http-headers' },
              { text: 'HTTP 缓存机制', link: '/interview/frontend-basics/http-cache' },
              { text: 'HTTP/1.1 → 2 → 3 演进', link: '/interview/frontend-basics/http-evolution' },
              { text: 'TCP 三次握手与 HTTPS', link: '/interview/frontend-basics/tcp-https' },
              { text: '跨域与 CORS/代理', link: '/interview/frontend-basics/cross-domain' },
              { text: 'HTTP 与 WebSocket', link: '/interview/frontend-basics/http-vs-socket' },
              { text: 'XSS 与 CSRF', link: '/interview/frontend-basics/xss-csrf' },
              { text: '单点登录（SSO）', link: '/interview/frontend-basics/single-sign-on' },
              { text: '前端登录请求加密流程', link: '/interview/frontend-basics/login-encryption' },
              { text: 'AbortController 中断请求', link: '/interview/frontend-basics/abort-controller' }
            ]
          },
          {
            text: '工程化与设计模式',
            collapsed: true,
            items: [
              { text: '模块化与构建（CJS/ESM/Vite）', link: '/interview/frontend-basics/esm-webpack-vite' },
              { text: '工程化常识（Git/pnpm/规范）', link: '/interview/frontend-basics/engineering-basics' },
              { text: '前端高频设计模式', link: '/interview/frontend-basics/frontend-design-patterns' }
            ]
          }
        ]
      },
      {
        text: 'Vue & React',
        collapsed: false,
        items: [
          { text: 'Vue 生命周期', link: '/interview/vue-react/vue-lifecycle' },
          { text: '组件通信方式', link: '/interview/vue-react/component-communication' },
          { text: 'reactive 与 ref 的区别', link: '/interview/vue-react/reactive-vs-ref' },
          { text: 'React 常用 Hooks', link: '/interview/vue-react/react-hooks' },
          { text: '组合式 vs 选项式 API', link: '/interview/vue-react/composition-vs-options' },
          { text: 'computed 与 watch', link: '/interview/vue-react/computed-watch' },
          { text: '列表为什么需要 key', link: '/interview/vue-react/list-key' },
          { text: 'React 性能优化（memo 三件套）', link: '/interview/vue-react/react-memo' },
          { text: 'setState 是同步还是异步', link: '/interview/vue-react/setstate-batch' },
          { text: 'React 闭包陷阱', link: '/interview/vue-react/hooks-closure' },
          { text: 'React Fiber 架构', link: '/interview/vue-react/fiber-architecture' },
          { text: 'Vue3 与 React Diff 对比', link: '/interview/vue-react/vue-react-diff' },
          { text: '前端路由原理（hash/history）', link: '/interview/vue-react/router-principle' },
          { text: '状态管理对比（Pinia/Redux）', link: '/interview/vue-react/state-management' },
          { text: '虚拟列表与长列表优化', link: '/interview/vue-react/virtual-list' },
          { text: 'v-if 与 v-show 的区别', link: '/interview/vue-react/v-if-v-show' },
          { text: 'data 为什么是一个函数', link: '/interview/vue-react/data-function' },
          { text: 'Vuex 的使用与缓存', link: '/interview/vue-react/vuex-cache' },
          { text: 'MVVM 架构理解', link: '/interview/vue-react/mvvm' }
        ]
      },
      {
        text: 'Java',
        collapsed: false,
        items: [
          {
            text: 'Java 基础',
            collapsed: false,
            items: [
              { text: 'String/StringBuilder 与常量池', link: '/interview/java/basics/string-types' },
              { text: '接口、抽象类与值传递', link: '/interview/java/basics/interface-vs-abstract' },
              { text: 'ArrayList 与 LinkedList', link: '/interview/java/basics/arraylist-linkedlist' },
              { text: '异常体系', link: '/interview/java/basics/exception-system' },
              { text: 'equals 与 hashCode 契约', link: '/interview/java/basics/equals-hashcode' },
              { text: '单例模式', link: '/interview/java/basics/singleton-pattern' },
              { text: '高频设计模式（工厂/策略/观察者）', link: '/interview/java/basics/design-patterns' },
              { text: 'HashMap 底层原理', link: '/interview/java/basics/hashmap' },
              { text: 'BIO/NIO/AIO 与多路复用', link: '/interview/java/basics/io-model' },
              { text: '反射与动态代理', link: '/interview/java/basics/reflection-proxy' }
            ]
          },
          {
            text: '并发编程',
            collapsed: false,
            items: [
              { text: '线程池参数与工作流程', link: '/interview/java/concurrent/thread-pool' },
              { text: 'synchronized 与 ReentrantLock', link: '/interview/java/concurrent/synchronized-vs-reentrantlock' },
              { text: 'CAS 原理与原子类', link: '/interview/java/concurrent/cas-atomic' },
              { text: 'ConcurrentHashMap', link: '/interview/java/concurrent/concurrent-hashmap' },
              { text: 'JUC 同步工具三兄弟', link: '/interview/java/concurrent/juc-tools' },
              { text: 'volatile 与 JMM', link: '/interview/java/concurrent/volatile-jmm' },
              { text: 'ThreadLocal 原理与内存泄漏', link: '/interview/java/concurrent/threadlocal' }
            ]
          },
          {
            text: 'JVM',
            collapsed: false,
            items: [
              { text: '运行时内存区域', link: '/interview/java/jvm/memory-model' },
              { text: 'GC 算法与收集器', link: '/interview/java/jvm/gc' },
              { text: '双亲委派模型', link: '/interview/java/jvm/classloading' },
              { text: 'JVM 调优思路与参数', link: '/interview/java/jvm/jvm-tuning' },
              { text: '线上 OOM 排查流程', link: '/interview/java/jvm/oom-troubleshoot' }
            ]
          },
          {
            text: 'MySQL',
            collapsed: false,
            items: [
              { text: '索引原理与失效场景', link: '/interview/java/mysql/index' },
              { text: '慢 SQL 优化流程', link: '/interview/java/mysql/slow-query' },
              { text: '主从复制与分库分表', link: '/interview/java/mysql/mysql-replication' },
              { text: '事务隔离级别与 MVCC', link: '/interview/java/mysql/transaction-mvcc' },
              { text: 'redo/undo/binlog 三大日志', link: '/interview/java/mysql/redo-undo-binlog' }
            ]
          },
          {
            text: 'Redis',
            collapsed: false,
            items: [
              { text: '底层数据结构与编码', link: '/interview/java/redis/data-structure' },
              { text: 'RDB 与 AOF 持久化', link: '/interview/java/redis/persistence' },
              { text: '穿透、击穿与雪崩', link: '/interview/java/redis/cache-three-brothers' },
              { text: '主从、哨兵与集群', link: '/interview/java/redis/redis-cluster' },
              { text: '缓存与数据库一致性', link: '/interview/java/redis/cache-consistency' },
              { text: 'Redis 分布式锁', link: '/interview/java/redis/distributed-lock' }
            ]
          },
          {
            text: 'Spring',
            collapsed: false,
            items: [
              { text: 'BeanFactory 与容器启动流程', link: '/interview/java/spring/container-refresh' },
              { text: 'IOC 与 AOP、循环依赖', link: '/interview/java/spring/ioc-aop' },
              { text: 'Bean 生命周期', link: '/interview/java/spring/bean-lifecycle' },
              { text: 'AOP 底层原理', link: '/interview/java/spring/aop-principle' },
              { text: '事务失效场景', link: '/interview/java/spring/transaction' },
              { text: 'SpringBoot 自动配置原理', link: '/interview/java/spring/springboot-autoconfig' }
            ]
          },
          {
            text: 'MyBatis',
            collapsed: false,
            items: [
              { text: 'MyBatis 核心机制', link: '/interview/java/mybatis/mybatis' }
            ]
          },
          {
            text: '消息队列',
            collapsed: false,
            items: [
              { text: '消息不丢失、不重复、顺序消费', link: '/interview/java/mq/message-reliability' },
              { text: '消息顺序性深入方案', link: '/interview/java/mq/message-ordering' },
              { text: 'MQ 高可用与消息积压', link: '/interview/java/mq/high-availability' }
            ]
          },
          {
            text: '分布式',
            collapsed: false,
            items: [
              { text: '接口幂等设计', link: '/interview/java/distributed/idempotency' },
              { text: '限流、熔断与降级', link: '/interview/java/distributed/rate-limit-circuit' },
              { text: '分布式事务方案', link: '/interview/java/distributed/distributed-transaction' }
            ]
          }
        ]
      },
      {
        text: '笔记',
        collapsed: true,
        items: [
          {
            text: 'Vite',
            collapsed: true,
            items: [
              {
                text: '基础配置',
                collapsed: false,
                items: [
                  { text: '配置文件与环境变量', link: '/notes/vite/config-basics' },
                  { text: 'resolve 与依赖预构建', link: '/notes/vite/resolve-deps' },
                  { text: 'server 与 preview', link: '/notes/vite/server-preview' },
                  { text: 'build 构建配置', link: '/notes/vite/build' },
                  { text: 'css / define / esbuild', link: '/notes/vite/css-define-esbuild' },
                  { text: '插件与常用插件', link: '/notes/vite/plugins' }
                ]
              },
              {
                text: '底层与插件开发',
                collapsed: false,
                items: [
                  { text: '底层原理（Dev 与 HMR）', link: '/notes/vite/dev-principle' },
                  { text: '插件开发基础', link: '/notes/vite/plugin-dev' }
                ]
              }
            ]
          },
          {
            text: 'Webpack',
            collapsed: true,
            items: [
              { text: '基础配置', link: '/notes/webpack/config-basics' },
              {
                text: '底层原理',
                collapsed: false,
                items: [
                  { text: '编译流程与架构', link: '/notes/webpack/architecture-flow' },
                  { text: 'loader 与 plugin 开发', link: '/notes/webpack/loader-plugin' }
                ]
              }
            ]
          },
          {
            text: 'Rollup',
            collapsed: true,
            items: [
              { text: '基础配置', link: '/notes/rollup/config-basics' },
              {
                text: '底层原理',
                collapsed: false,
                items: [
                  { text: '执行流程与架构总览', link: '/notes/rollup/architecture-flow' },
                  { text: '插件生命周期与钩子', link: '/notes/rollup/plugin-hooks' },
                  { text: 'Tree-shaking 原理', link: '/notes/rollup/tree-shaking' }
                ]
              }
            ]
          },
          {
            text: 'esbuild',
            collapsed: true,
            items: [
              { text: '基础配置', link: '/notes/esbuild/config-basics' }
            ]
          },
          {
            text: 'Spring Boot',
            collapsed: true,
            items: [
              { text: '工程与配置笔记', link: '/notes/spring-boot/project-config' },
              { text: 'Web 开发实践笔记', link: '/notes/spring-boot/web-development' }
            ]
          },
          {
            text: 'MyBatis-Plus',
            collapsed: true,
            items: [
              { text: '基础用法（BaseMapper / IService）', link: '/notes/mybatis-plus/basic-usage' },
              { text: 'Wrapper 条件构造器', link: '/notes/mybatis-plus/wrapper' },
              { text: '进阶（生成器 / 逻辑删除 / 自定义 SQL）', link: '/notes/mybatis-plus/advanced' }
            ]
          }
        ]
      },
      {
        text: 'UWB 定位',
        collapsed: false,
        items: [
          { text: '坯车定位对接方案', link: '/uwb/positioning-integration' }
        ]
      }
    ],

    // 顶部导航
    nav: [
      { text: '首页', link: '/' },
      { text: 'Vue 底层', link: '/vue/reactivity/reactivity' },
      { text: 'React 底层', link: '/react/' },
      { text: '前端基础', link: '/interview/frontend-basics/closure-this' },
      { text: 'Vue & React', link: '/interview/vue-react/reactive-vs-ref' },
      { text: 'Java', link: '/interview/java/basics/hashmap' },
      { text: '笔记', link: '/notes/vite/config-basics' }
    ],

    // 社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/core' }
    ],

    // 搜索
    search: {
      provider: 'local'
    },

    // 页脚
    footer: {
      message: '基于 Vue / React 深度技术问答对话记录整理',
      copyright: 'MIT License'
    }
  }
})
