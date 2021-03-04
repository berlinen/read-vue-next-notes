import { ComponentInternalInstance, Data } from './component'
import { nextTick, queueJob } from './scheduler'
import { instanceWatch } from './apiWatch'
import { EMPTY_OBJ, hasOwn, isGloballyWhitelisted, NOOP } from '@vue/shared'
import {
  ReactiveEffect,
  UnwrapRef,
  toRaw,
  shallowReadonly
} from '@vue/reactivity'
import {
  ExtractComputedReturns,
  ComponentOptionsBase,
  ComputedOptions,
  MethodOptions,
  resolveMergedOptions
} from './componentOptions'
import { normalizePropsOptions } from './componentProps'
import { EmitsOptions, EmitFn } from './componentEmits'
import { Slots } from './componentSlots'
import {
  currentRenderingInstance,
  markAttrsAccessed
} from './componentRenderUtils'
import { warn } from './warning'

/**
 * Custom properties added to component instances in any way and can be accessed through `this`
 *
 * @example
 * Here is an example of adding a property `$router` to every component instance:
 * ```ts
 * import { createApp } from 'vue'
 * import { Router, createRouter } from 'vue-router'
 *
 * declare module '@vue/runtime-core' {
 *   interface ComponentCustomProperties {
 *     $router: Router
 *   }
 * }
 *
 * // effectively adding the router to every component instance
 * const app = createApp({})
 * const router = createRouter()
 * app.config.globalProperties.$router = router
 *
 * const vm = app.mount('#app')
 * // we can access the router from the instance
 * vm.$router.push('/')
 * ```
 */
export interface ComponentCustomProperties {}

// public properties exposed on the proxy, which is used as the render context
// in templates (as `this` in the render option)
export type ComponentPublicInstance<
  P = {}, // props type extracted from props option
  B = {}, // raw bindings returned from setup()
  D = {}, // return from data()
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  E extends EmitsOptions = {},
  PublicProps = P
> = {
  $: ComponentInternalInstance
  $data: D
  $props: PublicProps
  $attrs: Data
  $refs: Data
  $slots: Slots
  $root: ComponentPublicInstance | null
  $parent: ComponentPublicInstance | null
  $emit: EmitFn<E>
  $el: any
  $options: ComponentOptionsBase<P, B, D, C, M, E>
  $forceUpdate: ReactiveEffect
  $nextTick: typeof nextTick
  $watch: typeof instanceWatch
} & P &
  UnwrapRef<B> &
  D &
  ExtractComputedReturns<C> &
  M &
  ComponentCustomProperties

const publicPropertiesMap: Record<
  string,
  (i: ComponentInternalInstance) => any
> = {
  $: i => i,
  $el: i => i.vnode.el,
  $data: i => i.data,
  $props: i => (__DEV__ ? shallowReadonly(i.props) : i.props),
  $attrs: i => (__DEV__ ? shallowReadonly(i.attrs) : i.attrs),
  $slots: i => (__DEV__ ? shallowReadonly(i.slots) : i.slots),
  $refs: i => (__DEV__ ? shallowReadonly(i.refs) : i.refs),
  $parent: i => i.parent && i.parent.proxy,
  $root: i => i.root && i.root.proxy,
  $emit: i => i.emit,
  $options: i => (__FEATURE_OPTIONS__ ? resolveMergedOptions(i) : i.type),
  $forceUpdate: i => () => queueJob(i.update),
  $nextTick: () => nextTick,
  $watch: __FEATURE_OPTIONS__ ? i => instanceWatch.bind(i) : NOOP
}

const enum AccessTypes {
  SETUP,
  DATA,
  PROPS,
  CONTEXT,
  OTHER
}

export interface ComponentRenderContext {
  [key: string]: any
  _: ComponentInternalInstance
}
/**
 * @description
 * instance.ctx 的代理逻辑 get、set 和 has
 *
 * 当我们访问 instance.ctx 渲染上下文中的属性时，就会进入 get 函数
 *
 * 函数首先判断 key 不以 $ 开头的情况，这部分数据可能是 setupState、data、props、ctx 中的一种，其中 data、props 我们已经很熟悉了；setupState 就是 setup 函数返回的数据,ctx 包括了计算属性、组件方法和用户自定义的一些数据。
 * 如果 key 不以 $ 开头，那么就依次判断 setupState、data、props、ctx 中是否包含这个 key，如果包含就返回对应值。注意这个判断顺序很重要，在 key 相同时它会决定数据获取的优先级，
 *
 * 定义了 accessCache 作为渲染代理的属性访问缓存作用
 *
 * 触发 get 函数，这其中最昂贵的部分就是多次调用 hasOwn 去判断 key 在不在某个类型的数据中，但是在普通对象上执行简单的属性访问相对要快得多。所以在第一次获取 key 对应的数据后，我们利用 accessCache[key] 去缓存数据，下一次再次根据 key 查找数据，我们就可以直接通过 accessCache[key] 获取对应的值，
 */
export const PublicInstanceProxyHandlers: ProxyHandler<any> = {
  get({ _: instance }: ComponentRenderContext, key: string) {
    const {
      ctx,
      setupState,
      data,
      props,
      accessCache,
      type,
      appContext
    } = instance

    // data / props / ctx
    // This getter gets called for every property access on the render context
    // during render and is a major hotspot. The most expensive part of this
    // is the multiple hasOwn() calls. It's much faster to do a simple property
    // access on a plain object, so we use an accessCache object (with null
    // prototype) to memoize what access type a key corresponds to.
    if (key[0] !== '$') {
      // setupState / data / props / ctx
      // 渲染代理的属性访问缓存中
      const n = accessCache![key]
      if (n !== undefined) {
        // 如果存在缓存数据，就从缓存中取得
        switch (n) {
          case AccessTypes.SETUP:
            return setupState[key]
          case AccessTypes.DATA:
            return data[key]
          case AccessTypes.CONTEXT:
            return ctx[key]
          case AccessTypes.PROPS:
            return props![key]
          // default: just fallthrough
        }
      } else if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
        accessCache![key] = AccessTypes.SETUP
        // 从 setupState中取数据
        return setupState[key]
      } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
        accessCache![key] = AccessTypes.DATA
        // 从 data中取数据
        return data[key]
      } else if (
        // only cache other properties when instance has declared (thus stable)
        // props
        type.props &&
        hasOwn(normalizePropsOptions(type.props)[0]!, key)
      ) {
        accessCache![key] = AccessTypes.PROPS
        // 从 props中取数据
        return props![key]
      } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
        accessCache![key] = AccessTypes.CONTEXT
        // 从 ctx 中 取数据
        return ctx[key]
      } else {
        // 都取不到
        accessCache![key] = AccessTypes.OTHER
      }
    }
    // key 不以$开头判断标准
    //  $xxx 属性或方法（比如 $parent) => 是不是 vue-loader 编译注入的 css 模块内部的 key
    //  => 是不是用户自定义以 $ 开头的 key => 最后判断是不是全局属性
    // 如果都不满足，就剩两种情况了，即在非生产环境下就会报两种类型的警告，第一种是在 data 中定义的数据以 $ 开头的警告，因为 $ 是保留字符，不会做代理；第二种是在模板中使用的变量没有定义的警告。
    const publicGetter = publicPropertiesMap[key]
    let cssModule, globalProperties
    // public $xxx properties
    // 公开的 $xxx 属性或者方法
    if (publicGetter) {
      if (__DEV__ && key === '$attrs') {
        markAttrsAccessed()
      }
      return publicGetter(instance)
    } else if (
      // css module (injected by vue-loader)
      // css 模块 通过 value-loader 编译的时候注入
      (cssModule = type.__cssModules) &&
      (cssModule = cssModule[key])
    ) {
      return cssModule
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
      // user may set custom properties to `this` that start with `$`
      // 用户自定义的属性 也用 $ 开头
      accessCache![key] = AccessTypes.CONTEXT
      return ctx[key]
    } else if (
      // global properties
      // 全局定义的属性
      ((globalProperties = appContext.config.globalProperties),
      hasOwn(globalProperties, key))
    ) {
      return globalProperties[key]
    } else if (__DEV__ && currentRenderingInstance) {
     // 在模板中使用的变量如果没有定义，报警告
      warn(
        `Property ${JSON.stringify(key)} was accessed during render ` +
          `but is not defined on instance.`
      )
    }
  },
  /**
   * @description
   * 当我们修改 instance.ctx 渲染上下文中的属性的时候，
   * 函数主要做的事情就是对渲染上下文 instance.ctx 中的属性赋值
   * 它实际上是代理到对应的数据类型中去完成赋值操作的。
   * 仍然要注意顺序问题，和 get 一样，优先判断 setupState，然后是 data，接着是 props。
   *
   * @example
   * 如果是用户自定义的数据，比如在 created 生命周期内定义的数据 它仅用于组件上下文的共享
   * 当执行 this.userMsg 赋值的时候，会触发 set 函数，最终 userMsg 会被保留到 ctx 中。
   * export default {
        created() {
          this.userMsg = 'msg from user'
        }
      }
   * @param param0
   * @param key
   * @param value
   */
  set(
    { _: instance }: ComponentRenderContext,
    key: string,
    value: any
  ): boolean {
    const { data, setupState, ctx } = instance
    if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
      // 给 setupState 赋值
      setupState[key] = value
    } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
      // 给 data 赋值
      data[key] = value
    } else if (key in instance.props) {
      // 不能直接给 props 赋值
      __DEV__ &&
        warn(
          `Attempting to mutate prop "${key}". Props are readonly.`,
          instance
        )
      return false
    }
    // 不能给 Vue 内部以 $ 开头的保留属性赋值
    if (key[0] === '$' && key.slice(1) in instance) {
      __DEV__ &&
        warn(
          `Attempting to mutate public property "${key}". ` +
            `Properties starting with $ are reserved and readonly.`,
          instance
        )
      return false
    } else {
      if (__DEV__ && key in instance.appContext.config.globalProperties) {
        Object.defineProperty(ctx, key, {
          enumerable: true,
          configurable: true,
          value
        })
      } else {
         // 用户自定义数据赋值
        ctx[key] = value
      }
    }
    return true
  },
  /**
   * @description
   * has 代理过程，当我们判断属性是否存在于 instance.ctx 渲染上下文中时，就会进入 has 函数，
   * @example
   * export default {
        created () {
          console.log('msg' in this)
        }
      }
   *  依次判断 key 是否存在于 accessCache、data、setupState、props 、用户数据、公开属性以及全局属性中，然后返回结果。
   * @param param0
   * @param key
   */
  has(
    {
      _: { data, setupState, accessCache, ctx, type, appContext }
    }: ComponentRenderContext,
    key: string
  ) {
    // 依次判断
    return (
      accessCache![key] !== undefined ||
      (data !== EMPTY_OBJ && hasOwn(data, key)) ||
      (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) ||
      (type.props && hasOwn(normalizePropsOptions(type.props)[0]!, key)) ||
      hasOwn(ctx, key) ||
      hasOwn(publicPropertiesMap, key) ||
      hasOwn(appContext.config.globalProperties, key)
    )
  }
}

if (__DEV__ && !__TEST__) {
  PublicInstanceProxyHandlers.ownKeys = (target: ComponentRenderContext) => {
    warn(
      `Avoid app logic that relies on enumerating keys on a component instance. ` +
        `The keys will be empty in production mode to avoid performance overhead.`
    )
    return Reflect.ownKeys(target)
  }
}

export const RuntimeCompiledPublicInstanceProxyHandlers = {
  ...PublicInstanceProxyHandlers,
  get(target: ComponentRenderContext, key: string) {
    // fast path for unscopables when using `with` block
    if ((key as any) === Symbol.unscopables) {
      return
    }
    return PublicInstanceProxyHandlers.get!(target, key, target)
  },
  has(_: ComponentRenderContext, key: string) {
    return key[0] !== '_' && !isGloballyWhitelisted(key)
  }
}

// In dev mode, the proxy target exposes the same properties as seen on `this`
// for easier console inspection. In prod mode it will be an empty object so
// these properties definitions can be skipped.
export function createRenderContext(instance: ComponentInternalInstance) {
  const target: Record<string, any> = {}

  // expose internal instance for proxy handlers
  Object.defineProperty(target, `_`, {
    configurable: true,
    enumerable: false,
    get: () => instance
  })

  // expose public properties
  Object.keys(publicPropertiesMap).forEach(key => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      get: () => publicPropertiesMap[key](instance),
      // intercepted by the proxy so no need for implementation,
      // but needed to prevent set errors
      set: NOOP
    })
  })

  // expose global properties
  const { globalProperties } = instance.appContext.config
  Object.keys(globalProperties).forEach(key => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      get: () => globalProperties[key],
      set: NOOP
    })
  })

  return target as ComponentRenderContext
}

// dev only
export function exposePropsOnRenderContext(
  instance: ComponentInternalInstance
) {
  const {
    ctx,
    type: { props: propsOptions }
  } = instance
  if (propsOptions) {
    Object.keys(normalizePropsOptions(propsOptions)[0]!).forEach(key => {
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        get: () => instance.props[key],
        set: NOOP
      })
    })
  }
}

// dev only
export function exposeSetupStateOnRenderContext(
  instance: ComponentInternalInstance
) {
  const { ctx, setupState } = instance
  Object.keys(toRaw(setupState)).forEach(key => {
    Object.defineProperty(ctx, key, {
      enumerable: true,
      configurable: true,
      get: () => setupState[key],
      set: NOOP
    })
  })
}
