import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Vue 深度技术问答',
  description: 'Vue 核心原理与实战技巧',

  // 忽略 README/QUICKSTART 中的本地开发示例地址
  ignoreDeadLinks: [/localhost:5173/],

  // 主题配置
  themeConfig: {
    // 侧边栏
    sidebar: [
      {
        text: '基础与实战',
        collapsed: false,
        items: [
          { text: 'Arco Design 配置', link: '/vue/basics/arco-config' },
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
          { text: '编译优化', link: '/vue/compiler/compile-optimization' },
          { text: 'render 和 h 函数', link: '/vue/rendering/render-and-h' },
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
          { text: 'v-model 原理', link: '/vue/components/v-model' },
          { text: 'keep-alive 原理', link: '/vue/components/keep-alive' },
          { text: '函数式组件', link: '/vue/components/functional-component' }
        ]
      },
      {
        text: '高级话题',
        collapsed: false,

        items: [
          { text: '运行时架构', link: '/vue/advanced/runtime-architecture' },
          { text: '自定义渲染器', link: '/vue/advanced/custom-renderer' },
          { text: 'SSR 与水合', link: '/vue/advanced/ssr' }
        ]
      },
      {
        text: '框架对比',
        collapsed: false,
        items: [
          { text: 'Vue vs React', link: '/compare/vue-vs-react' }
        ]
      },
      {
        text: 'React 底层',
        collapsed: false,
        items: [
          { text: 'React 原理（规划中）', link: '/react/' }
        ]
      }
    ],

    // 顶部导航
    nav: [
      { text: '首页', link: '/' },
      { text: 'Vue 原理', link: '/vue/reactivity/reactivity' },
      { text: '编译优化', link: '/vue/compiler/compile-optimization' },
      { text: 'Vue vs React', link: '/compare/vue-vs-react' },
      { text: 'React', link: '/react/' }
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
      message: '基于 Vue 深度技术问答对话记录整理',
      copyright: 'MIT License'
    }
  }
})
