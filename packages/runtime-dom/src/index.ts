import {
  createRenderer,
  createHydrationRenderer,
  warn,
  RootRenderFunction,
  CreateAppFunction,
  Renderer,
  HydrationRenderer,
  App,
  RootHydrateFunction
} from '@vue/runtime-core'
import { nodeOps } from './nodeOps'
import { patchProp } from './patchProp'
// Importing from the compiler, will be tree-shaken in prod
import { isFunction, isString, isHTMLTag, isSVGTag } from '@vue/shared'
// 渲染相关的一些配置，比如更新属性的方法，操作dom的方法
const rendererOptions = {
  patchProp,
  ...nodeOps
}

// lazy create the renderer - this makes core renderer logic tree-shakable
// in case the user only imports reactivity utilities from Vue.
let renderer: Renderer | HydrationRenderer

let enabledHydration = false
// 延时创建渲染器， 当用户依赖响应式包的时候，可以通过tree-shaking移除核心渲染逻辑相关的代码
function ensureRenderer() {
  return renderer || (renderer = createRenderer(rendererOptions))
}

function ensureHydrationRenderer() {
  renderer = enabledHydration
    ? renderer
    : createHydrationRenderer(rendererOptions)
  enabledHydration = true
  return renderer as HydrationRenderer
}

// use explicit type casts here to avoid import() calls in rolled-up d.ts
export const render = ((...args) => {
  ensureRenderer().render(...args)
}) as RootRenderFunction<Element>

export const hydrate = ((...args) => {
  ensureHydrationRenderer().hydrate(...args)
}) as RootHydrateFunction
/**
 * 做两件事情
 * 1 创建app对象
 * 2 重写mount
 */
export const createApp = ((...args) => {
  // 创建app对象
  // ensureRenderer用来创建一个渲染器对象 包含一个createApp方法
  // createApp时执行createAppApi返回的函数，接收rootComponent, prop两个参数
  // 应用层面执行createApp（App）方法时候 会把App组件对象作为根组件传递给rootComponent createApp内部就创建了一个app对象， app对象会提供mount方法 该方法用来挂载组件
  const app = ensureRenderer().createApp(...args)


  if (__DEV__) {
    injectNativeTagCheck(app)
  }

  // app对象中已包含mount方法
  // app对象中的是mount针对跨平台渲染挂载，为了不破坏跨平台方案，现在需要对web端重写
  const { mount } = app
  // 重写mount 方法 针对web
  app.mount = (containerOrSelector: Element | string): any => {
    // 标准化容器
    const container = normalizeContainer(containerOrSelector)
    if (!container) return
    const component = app._component
    // 如组件对象没有定义 render 函数和 template 模板，则取容器的 innerHTML 作为组件模板内容
    if (!isFunction(component) && !component.render && !component.template) {
      component.template = container.innerHTML
    }
    // 挂载前清空容器内容
    // clear content before mounting
    container.innerHTML = ''
    // 真正的挂载
    const proxy = mount(container)
    container.removeAttribute('v-cloak')
    return proxy
  }

  return app
}) as CreateAppFunction<Element>

export const createSSRApp = ((...args) => {
  const app = ensureHydrationRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
  }

  const { mount } = app
  app.mount = (containerOrSelector: Element | string): any => {
    const container = normalizeContainer(containerOrSelector)
    if (container) {
      return mount(container, true)
    }
  }

  return app
}) as CreateAppFunction<Element>

function injectNativeTagCheck(app: App) {
  // Inject `isNativeTag`
  // this is used for component name validation (dev only)
  Object.defineProperty(app.config, 'isNativeTag', {
    value: (tag: string) => isHTMLTag(tag) || isSVGTag(tag),
    writable: false
  })
}
/**
 * @desc 标准化容器
 * @param container
 * @type {{ string | Element }} if string => string => element
 */
function normalizeContainer(container: Element | string): Element | null {
  if (isString(container)) {
    const res = document.querySelector(container)
    if (__DEV__ && !res) {
      warn(`Failed to mount app: mount target selector returned null.`)
    }
    return res
  }
  return container
}

// DOM-only runtime directive helpers
export {
  vModelText,
  vModelCheckbox,
  vModelRadio,
  vModelSelect,
  vModelDynamic
} from './directives/vModel'
export { withModifiers, withKeys } from './directives/vOn'
export { vShow } from './directives/vShow'

// DOM-only components
export { Transition, TransitionProps } from './components/Transition'
export {
  TransitionGroup,
  TransitionGroupProps
} from './components/TransitionGroup'

// re-export everything from core
// h, Component, reactivity API, nextTick, flags & types
export * from '@vue/runtime-core'
