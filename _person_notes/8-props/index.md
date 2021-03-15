## Props 的更新

所谓 Props 的更新主要是指 Props 数据的更新，它最直接的反应是会触发组件的重新渲染，我们可以通过一个简单的示例分析这个过程。例如我们有这样一个子组件 HelloWorld，它是这样定义的：

```vue
<template>
  <div>
    <p>{{ msg }}</p>
  </div>
</template>
<script>
  export default {
    props: {
      msg: String
    }
  }
</script>
```

这里，HelloWorld 组件接受一个 msg prop，然后在模板中渲染这个 msg。

然后我们在 App 父组件中引入这个子组件，它的定义如下：

```vue
<template>
  <hello-world :msg="msg"></hello-world>
  <button @click="toggleMsg">Toggle Msg</button>
</template>
<script>
  import HelloWorld from './components/HelloWorld'
  export default {
    components: { HelloWorld },
    data() {
      return {
        msg: 'Hello world'
      }
    },
    methods: {
      toggleMsg() {
        this.msg = this.msg === 'Hello world' ? 'Hello Vue' : 'Hello world'
      }
    }
  }
</script>
```

我们给 HelloWorld 子组件传递的 prop 值是 App 组件中定义的 msg 变量，它的初始值是 Hello world，在子组件的模板中会显示出来。

接着当我们点击按钮修改 msg 的值的时候，就会触发父组件的重新渲染，因为我们在模板中引用了这个 msg 变量。我们会发现这时 HelloWorld 子组件显示的字符串变成了 Hello Vue，那么子组件是如何被触发重新渲染的呢？

组件的重新渲染会触发 patch 过程，然后遍历子节点递归 patch，那么遇到组件节点，会执行 updateComponent 方法：

```js
const updateComponent = (n1, n2, parentComponent, optimized) => {
  const instance = (n2.component = n1.component)
  // 根据新旧子组件 vnode 判断是否需要更新子组件
  if (shouldUpdateComponent(n1, n2, parentComponent, optimized)) {
    // 新的子组件 vnode 赋值给 instance.next
    instance.next = n2
    // 子组件也可能因为数据变化被添加到更新队列里了，移除它们防止对一个子组件重复更新
    invalidateJob(instance.update)
    // 执行子组件的副作用渲染函数
    instance.update()
  }
  else {
    // 不需要更新，只复制属性
    n2.component = n1.component
    n2.el = n1.el
  }
}
```

在这个过程中，会执行 shouldUpdateComponent 方法判断是否需要更新子组件，内部会对比 props，由于我们的 prop 数据 msg 由 Hello world 变成了 Hello Vue，值不一样所以 shouldUpdateComponent 会返回 true，这样就把新的子组件 vnode 赋值给 instance.next，然后执行 instance.update 触发子组件的重新渲染。

所以这就是触发子组件重新渲染的原因，但是子组件重新渲染了，子组件实例的 instance.props 的数据需要更新才行，不然还是渲染之前的数据，那么是如何更新 instance.props 的呢，我们接着往下看。

执行 instance.update 函数，实际上是执行 componentEffect 组件副作用渲染函数：

```js
const setupRenderEffect = (instance, initialVNode, container, anchor, parentSuspense, isSVG, optimized) => {
  // 创建响应式的副作用渲染函数
  instance.update = effect(function componentEffect() {
    if (!instance.isMounted) {
      // 渲染组件
    }
    else {
      // 更新组件
      let { next, vnode } = instance
      // next 表示新的组件 vnode
      if (next) {
        // 更新组件 vnode 节点信息
        updateComponentPreRender(instance, next, optimized)
      }
      else {
        next = vnode
      }
      // 渲染新的子树 vnode
      const nextTree = renderComponentRoot(instance)
      // 缓存旧的子树 vnode
      const prevTree = instance.subTree
      // 更新子树 vnode
      instance.subTree = nextTree
      // 组件更新核心逻辑，根据新旧子树 vnode 做 patch
      patch(prevTree, nextTree,
        // 如果在 teleport 组件中父节点可能已经改变，所以容器直接找旧树 DOM 元素的父节点
        hostParentNode(prevTree.el),
        // 参考节点在 fragment 的情况可能改变，所以直接找旧树 DOM 元素的下一个节点
        getNextHostNode(prevTree),
        instance,
        parentSuspense,
        isSVG)
      // 缓存更新后的 DOM 节点
      next.el = nextTree.el
    }
  }, prodEffectOptions)
}
```

在更新组件的时候，会判断是否有 instance.next,它代表新的组件 vnode，根据前面的逻辑 next 不为空，所以会执行 updateComponentPreRender 更新组件 vnode 节点信息，

```js
const updateComponentPreRender = (instance, nextVNode, optimized) => {
  nextVNode.component = instance
  const prevProps = instance.vnode.props
  instance.vnode = nextVNode
  instance.next = null
  updateProps(instance, nextVNode.props, prevProps, optimized)
  updateSlots(instance, nextVNode.children)
}
```

其中，会执行 updateProps 更新 props 数据，我们来看它的实现：

```js
function updateProps(instance, rawProps, rawPrevProps, optimized) {

  const { props, attrs, vnode: { patchFlag } } = instance

  const rawCurrentProps = toRaw(props)

  const [options] = normalizePropsOptions(instance.type)

  if ((optimized || patchFlag > 0) && !(patchFlag & 16 /* FULL_PROPS */)) {

    if (patchFlag & 8 /* PROPS */) {

      // 只更新动态 props 节点

      const propsToUpdate = instance.vnode.dynamicProps

      for (let i = 0; i < propsToUpdate.length; i++) {

        const key = propsToUpdate[i]

        const value = rawProps[key]

        if (options) {

          if (hasOwn(attrs, key)) {

            attrs[key] = value

          }

          else {

            const camelizedKey = camelize(key)

            props[camelizedKey] = resolvePropValue(options, rawCurrentProps, camelizedKey, value)

          }

        }

        else {

          attrs[key] = value

        }

      }

    }

  }

  else {

    // 全量 props 更新

    setFullProps(instance, rawProps, props, attrs)

    // 因为新的 props 是动态的，把那些不在新的 props 中但存在于旧的 props 中的值设置为 undefined

    let kebabKey

    for (const key in rawCurrentProps) {

      if (!rawProps ||

        (!hasOwn(rawProps, key) &&

          ((kebabKey = hyphenate(key)) === key || !hasOwn(rawProps, kebabKey)))) {

        if (options) {

          if (rawPrevProps &&

            (rawPrevProps[key] !== undefined ||

              rawPrevProps[kebabKey] !== undefined)) {

            props[key] = resolvePropValue(options, rawProps || EMPTY_OBJ, key, undefined)

          }

        }

        else {

          delete props[key]

        }

      }

    }

  }

  if ((process.env.NODE_ENV !== 'production') && rawProps) {

    validateProps(props, instance.type)

  }

}

```

updateProps 主要的目标就是把父组件渲染时求得的 props 新值，更新到子组件实例的 instance.props 中。

在编译阶段，我们除了捕获一些动态 vnode，也捕获了动态的 props，所以我们可以只去比对动态的 props 数据更新。

当然，如果不满足优化的条件，我们也可以通过 setFullProps 去全量比对更新 props，并且，由于新的 props 可能是动态的，因此会把那些不在新 props 中但存在于旧 props 中的值设置为 undefined。

好了，至此我们搞明白了子组件实例的 props 值是如何更新的，那么我们现在来思考一下前面的一个问题，为什么 instance.props 需要变成响应式呢？其实这是一种需求，因为我们也希望在子组件中可以监听 props 值的变化做一些事情，举个例子：

```js
import { ref, h, defineComponent, watchEffect } from 'vue'
const count = ref(0)
let dummy
const Parent = {
  render: () => h(Child, { count: count.value })
}
const Child = defineComponent({
  props: { count: Number },
  setup(props) {
    watchEffect(() => {
      dummy = props.count
    })
    return () => h('div', props.count)
  }
})
count.value++
```

这里，我们定义了父组件 Parent 和子组件 Child，子组件 Child 中定义了 prop count，除了在渲染模板中引用了 count，我们在 setup 函数中通过了 watchEffect 注册了一个回调函数，内部依赖了 props.count，当修改 count.value 的时候，我们希望这个回调函数也能执行，所以这个 prop 的值需要是响应式的，由于 setup 函数的第一个参数是props 变量，其实就是组件实例 instance.props，所以也就是要求 instance.props 是响应式的。

我们再来看为什么用 shallowReactive API 呢？shallow 的字面意思是浅的，从实现上来说，就是不会递归执行 reactive，只劫持最外一层对象。

shallowReactive 和普通的 reactive 函数的主要区别是处理器函数不同，我们来回顾 getter 的处理器函数：

```js
function createGetter(isReadonly = false, shallow = false) {

  return function get(target, key, receiver) {

    if (key === "__v_isReactive" /* IS_REACTIVE */) {

      return !isReadonly;

    }

    else if (key === "__v_isReadonly" /* IS_READONLY */) {

      return isReadonly;

    }

    else if (key === "__v_raw" /* RAW */ &&

      receiver ===

      (isReadonly

        ? target["__v_readonly" /* READONLY */]

        : target["__v_reactive" /* REACTIVE */])) {

      return target;

    }

    const targetIsArray = isArray(target);

    if (targetIsArray && hasOwn(arrayInstrumentations, key)) {

      return Reflect.get(arrayInstrumentations, key, receiver);

    }

    const res = Reflect.get(target, key, receiver);

    if (isSymbol(key)

      ? builtInSymbols.has(key)

      : key === `__proto__` || key === `__v_isRef`) {

      return res;

    }

    if (!isReadonly) {

      track(target, "get" /* GET */, key);

    }

    if (shallow) {

      return res;

    }

    if (isRef(res)) {

      return targetIsArray ? res : res.value;

    }

    if (isObject(res)) {

      return isReadonly ? readonly(res) : reactive(res);

    }

    return res;

  };

}

```

shallowReactive 创建的 getter 函数，shallow 变量为 true，那么就不会执行后续的递归 reactive 逻辑。也就是说，shallowReactive 只把对象 target 的最外一层属性的访问和修改处理成响应式。

之所以可以这么做，是因为 props 在更新的过程中，只会修改最外层属性，所以用 shallowReactive 就足够了。