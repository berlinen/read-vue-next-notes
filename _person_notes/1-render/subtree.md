## subtree 子树vnode  &&  initialVnode 组件vnode

首先，是渲染组件生成 subTree，它也是一个 vnode 对象。这里要注意别把 subTree 和 initialVNode 弄混了（其实在 Vue.js 3.0 中，根据命名我们已经能很好地区分它们了，而在 Vue.js 2.x 中它们分别命名为 _vnode 和 $vnode）。举个例子说明，在父组件 App 中里引入了 Hello 组件：

```vue
<template>
  <div class="app">
    <p>This is an app.</p>
    <hello></hello>
  </div>
</template>
```

在 Hello 组件中是 <div> 标签包裹着一个 <p> 标签：

```vue
<template>
  <div class="hello">
    <p>Hello, Vue 3.0!</p>
  </div>
</template>
```


在 App 组件中， <hello> 节点渲染生成的 vnode ，对应的就是 Hello 组件的 initialVNode ，为了好记，你也可以把它称作“组件 vnode”。

而 Hello 组件内部整个 DOM 节点对应的 vnode 就是执行 renderComponentRoot 渲染生成对应的 subTree，我们可以把它称作“子树 vnode”。

### 子树vnode

1. 每个组件都有render函数， 即使你写 template，也会编译成 render 函数，

2. renderComponentRoot 函数就是去执行 render 函数创建整个组件树内部的 vnode，

3. 把这个 vnode 再经过内部一层标准化，就得到了该函数的返回结果：子树 vnode。 normalLize

4. 渲染生成子树 vnode 后，接下来就是继续调用 patch 函数把子树 vnode 挂载到 container 中了。

5. 渲染普通dom节点











