## proxy

![avatar](/_person_notes/images/proxy.png);

它和前面 Vue.js 2.x 的响应式原理图很接近，其实 Vue.js 3.0 在响应式的实现思路和 Vue.js 2.x 差别并不大，主要就是 劫持数据的方式改成用 Proxy 实现 ， 以及收集的依赖由 watcher 实例变成了组件副作用渲染函数 