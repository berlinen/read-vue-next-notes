## 生命周期

```js
//  Vue.js 3.x 生命周期 API 改写上例
import { onMounted, onBeforeUnmount } from 'vue'

export default {
  setup() {
    // 做一些初始化工作

    onMounted(() => {
      // 可以拿到 DOM 节点
    })
    onBeforeUnmount(()=>{
      // 做一些清理操作
    })
  }
}
```

可以看到，在 Vue.js 3.0 中，setup 函数已经替代了 Vue.js 2.x 的 beforeCreate 和 created 钩子函数，我们可以在 setup 函数做一些初始化工作，比如发送一个异步 Ajax 请求获取数据。

我们用 onMounted API 替代了 Vue.js 2.x 的 mounted 钩子函数，用 onBeforeUnmount API 替代了 Vue.js 2.x 的 beforeDestroy 钩子函数。

Vue.js 3.0 针对 Vue.js 2.x 的生命周期钩子函数做了全面替换，映射关系如下：

```js
beforeCreate -> 使用 setup()
created -> 使用 use setup()
beforeMount -> onBeforeMount
mounted -> onMounted
beforeUpdate -> onBeforeUpdate
updated -> onUpdated
beforeDestroy-> onBeforeUnmount
destroyed -> onUnmounted
activated -> onActivated
deactivated -> onDeactivated
errorCaptured -> onErrorCaptured
```

，Vue.js 3.0 还新增了两个用于调试的生命周期 API：onRenderTracked 和 onRenderTriggered。

onRenderTracked 和 onRenderTriggered 是 Vue.js 3.0 新增的生命周期 API，它们是在开发阶段渲染调试用的。

### 实际场景的应用：

```vue
<template>
  <div>
    <div>
      <p>{{count}}</p>
      <button @click="increase">Increase</button>
    </div>
  </div>
</template>
<script>
import { ref, onRenderTracked, onRenderTriggered } from 'vue'

export default {
  setup() {
    const count = ref(0);
    function increase () {
      count.value++
    }
    onRenderTracked(e) => {
      console.log(e)
      debugger
    }
    onRenderTriggered(e => {
      console.log(e)
      debugger
    })
    return {
      count,
      increase
    }
  }
}
</script>
```

像这样在开发阶段，我们可以通过注册这两个钩子函数，来追踪组件渲染的依赖来源以及触发组件重新渲染的数据更新来源。

![avatar](/_person_notes/images/life.png);