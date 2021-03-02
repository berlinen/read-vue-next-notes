## diff 过程

组件 App 中里引入了 Hello 组件：

```vue
<template>
 <div class="app">
    <p>This is an app.</p>
    <hello :msg="msg"></hello>
    <button @click="toggle">Toggle msg</button>
  </div>
</template>

<script>
 export default {
   data () {
     return {
       msg: 'vue'
     }
   },

   methods: {
     toggle () {
       this.msg = this.msg === 'vue' ? 'world' : 'vue'
     }
   }
 }
</script>
```

Hello 组件中是 <div> 包裹着一个 <p> 标签， 如下所示：

```vue
<template>
  <div class="hello">
    <p>Hello, {{msg}}</p>
  </div>
</template>

<script>
export default {
  props: {
    msg: String
  }
}
<script>
```

渲染流程分析

app组件 -- processElement div vnode -- true dom -- Hello -- processComponent

这里 App 组件的根节点是 div 标签，重新渲染的子树 vnode 节点是一个普通元素的 vnode，应该先走 processElement 逻辑。组件的更新最终还是要转换成内部真实 DOM 的更新，而实际上普通元素的处理流程才是真正做 DOM 的更新，由于稍后我们会详细分析普通元素的处理流程，所以我们先跳过这里，继续往下看。

和渲染过程类似，更新过程也是一个树的深度优先遍历过程，更新完当前节点后，就会遍历更新它的子节点，因此在遍历的过程中会遇到 hello 这个组件 vnode 节点，就会执行到 processComponent 处理逻辑

```js
const processComponent = (n1, n2, contianer, parentComponent, parentSuspense, isSvg, optimized) => {
  if (n1 == null) {
    // 挂载组件
  }
  else {
    // 更新子组件
    updateComponent(n1, n2, parentComponent, optimized)
  }
}

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

### 流程分析

1. processComponent 主要通过执行 updateComponent 函数来更新子组件，

2. updateComponent 函数在更新子组件的时候，会先执行 shouldUpdateComponent 函数, 根据新旧子组件 vnode 来判断是否需要更新子组件

在 shouldUpdateComponent 函数的内部，主要是通过检测和对比组件 vnode 中的 props、chidren、dirs、transiton 等属性，来决定子组件是否需要更新。

 一个组件的子组件是否需要更新，我们主要依据子组件 vnode 是否存在一些会影响组件更新的属性变化进行判断，如果存在就会更新子组件。

3. shouldUpdateComponent 返回 true， 那么在它的最后，先执行 invalidateJob（instance.update）避免子组件由于自身数据变化导致的重复更新，然后又执行了子组件的副作用渲染函数 instance.update 来主动触发子组件的更新。


