// - Parse expressions in templates into compound expressions so that each
//   identifier gets more accurate source-map locations.
//
// - Prefix identifiers with `_ctx.` so that they are accessed from the render
//   context
//
// - This transform is only applied in non-browser builds because it relies on
//   an additional JavaScript parser. In the browser, there is no source-map
//   support and the code is wrapped in `with (this) { ... }`.
import { NodeTransform, TransformContext } from '../transform'
import {
  NodeTypes,
  createSimpleExpression,
  ExpressionNode,
  SimpleExpressionNode,
  CompoundExpressionNode,
  createCompoundExpression
} from '../ast'
import {
  advancePositionWithClone,
  isSimpleIdentifier,
  parseJS,
  walkJS
} from '../utils'
import { isGloballyWhitelisted, makeMap } from '@vue/shared'
import { createCompilerError, ErrorCodes } from '../errors'
import { Node, Function, Identifier, ObjectProperty } from '@babel/types'

const isLiteralWhitelisted = /*#__PURE__*/ makeMap('true,false,null,this')
/***
 * @description
 * 表达式节点转换函数
 * 需要注意的是，只有在 Node.js 环境下的编译或者是 Web 端的非生产环境下才会执行 transformExpression，
 *
 * transformExpression 主要做的事情就是 转换插值 和 元素指令中的动态表达式，把简单的表达式对象转换成复合表达式对象，内部主要是通过 processExpression 函数完成。举个例子，比如这个模板：{{ msg + test }}，它执行 parse 后生成的表达式节点 node.content 值为一个简单的表达式对象：
 * @example
 * {
 *   "type": 4,
 *    "isStatic": false,
     "isConstant": false,
     "content": "msg + test"
 * }
  经过 processExpression 处理后，node.content 的值变成了一个复合表达式对象：
  {
    "type": 8,
    "children": [
      {
        "type": 4,
        "isConstant": false,
        "content": "_ctx.msg",
        "isStatic": false
      },
      " + ",
      {
        "type": 4,
        "isConstant": false,
        "content": "_ctx.test",
        "isStatic": false
      }
    ],
    "identifiers": []
  }
  这里，我们重点关注对象中的 children 属性，它是一个长度为 3 的数组，其实就是把表达式msg + test拆成了三部分，其中变量 msg 和 test 对应都加上了前缀 _ctx。

  我们就要想到模板中引用的的 msg 和 test 对象最终都是在组件实例中访问的，但为了书写模板方便，Vue.js 并没有让我们在模板中手动加组件实例的前缀，例如：{{ this.msg + this.test }}，这样写起来就会不够方便，但如果用 JSX 写的话，通常要手动写 this。

  你可能会有疑问，为什么 Vue.js 2.x 编译的结果没有 _ctx 前缀呢？这是因为 Vue.js 2.x 的编译结果使用了”黑魔法“ with，比如上述模板，在 Vue.js 2.x 最终编译的结果：with(this){return _s(msg + test)}。

  它利用 with 的特性动态去 this 中查找 msg 和 test 属性，所以不需要手动加前缀。

  但是，Vue.js 3.0 在 Node.js 端的编译结果舍弃了 with，它会在 processExpression 过程中对表达式动态分析，给该加前缀的地方加上前缀。




 */
export const transformExpression: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.INTERPOLATION) {
    // 处理插值中的动态表达式
    node.content = processExpression(
      node.content as SimpleExpressionNode,
      context
    )
  } else if (node.type === NodeTypes.ELEMENT) {
    // handle directives on element
    // 处理元素指令中的动态表达式
    for (let i = 0; i < node.props.length; i++) {
      const dir = node.props[i]
      // do not process for v-on & v-for since they are special handled
      // v-on 和 v-for 不处理，因为它们都有各自的处理逻辑
      if (dir.type === NodeTypes.DIRECTIVE && dir.name !== 'for') {
        const exp = dir.exp
        const arg = dir.arg
        // do not process exp if this is v-on:arg - we need special handling
        // for wrapping inline statements.
        // v-on 和 v-for 不处理，因为它们都有各自的处理逻辑
        if (
          exp &&
          exp.type === NodeTypes.SIMPLE_EXPRESSION &&
          !(dir.name === 'on' && arg)
        ) {
          dir.exp = processExpression(
            exp,
            context,
            // slot args must be processed as function params
            dir.name === 'slot'
          )
        }
        if (arg && arg.type === NodeTypes.SIMPLE_EXPRESSION && !arg.isStatic) {
          dir.arg = processExpression(arg, context)
        }
      }
    }
  }
}

interface PrefixMeta {
  prefix?: string
  isConstant: boolean
  start: number
  end: number
  scopeIds?: Set<string>
}

// Important: since this function uses Node.js only dependencies, it should
// always be used with a leading !__BROWSER__ check so that it can be
// tree-shaken from the browser build.
/**
 * processExpression
 * 这个过程肯定有一定的成本，因为它内部依赖了 @babel/parser 库去解析表达式生成 AST 节点，并依赖了 estree-walker 库去遍历这个 AST 节点，然后对节点分析去判断是否需要加前缀，接着对 AST 节点修改，最终转换生成新的表达式对象。
 *
 *  @babel/parser 这个库通常是在 Node.js 端用的，而且这库本身体积非常大，如果打包进 Vue.js 的话会让包体积膨胀 4 倍，所以我们并不会在生产环境的 Web 端引入这个库，Web 端生产环境下的运行时编译最终仍然会用 with 的方式。
 *
 * 所以
 * 只有在 Node.js 环境下的编译或者是 Web 端的非生产环境下才会执行 transformExpression。
 * @param node
 * @param context
 * @param asParams
 * @param asRawStatements
 */
export function processExpression(
  node: SimpleExpressionNode,
  context: TransformContext,
  // some expressions like v-slot props & v-for aliases should be parsed as
  // function params
  asParams = false,
  // v-on handler values may contain multiple statements
  asRawStatements = false
): ExpressionNode {
  if (!context.prefixIdentifiers || !node.content.trim()) {
    return node
  }

  // fast path if expression is a simple identifier.
  const rawExp = node.content
  // bail on parens to prevent any possible function invocations.
  const bailConstant = rawExp.indexOf(`(`) > -1
  if (isSimpleIdentifier(rawExp)) {
    if (
      !asParams &&
      !context.identifiers[rawExp] &&
      !isGloballyWhitelisted(rawExp) &&
      !isLiteralWhitelisted(rawExp)
    ) {
      node.content = `_ctx.${rawExp}`
    } else if (!context.identifiers[rawExp] && !bailConstant) {
      // mark node constant for hoisting unless it's referring a scope variable
      node.isConstant = true
    }
    return node
  }

  let ast: any
  // exp needs to be parsed differently:
  // 1. Multiple inline statements (v-on, with presence of `;`): parse as raw
  //    exp, but make sure to pad with spaces for consistent ranges
  // 2. Expressions: wrap with parens (for e.g. object expressions)
  // 3. Function arguments (v-for, v-slot): place in a function argument position
  const source = asRawStatements
    ? ` ${rawExp} `
    : `(${rawExp})${asParams ? `=>{}` : ``}`
  try {
    ast = parseJS(source, {
      plugins: [
        ...context.expressionPlugins,
        // by default we enable proposals slated for ES2020.
        // full list at https://babeljs.io/docs/en/next/babel-parser#plugins
        // this will need to be updated as the spec moves forward.
        'bigInt',
        'optionalChaining',
        'nullishCoalescingOperator'
      ]
    }).program
  } catch (e) {
    context.onError(
      createCompilerError(
        ErrorCodes.X_INVALID_EXPRESSION,
        node.loc,
        undefined,
        e.message
      )
    )
    return node
  }

  const ids: (Identifier & PrefixMeta)[] = []
  const knownIds = Object.create(context.identifiers)
  const isDuplicate = (node: Node & PrefixMeta): boolean =>
    ids.some(id => id.start === node.start)

  // walk the AST and look for identifiers that need to be prefixed with `_ctx.`.
  walkJS(ast, {
    enter(node: Node & PrefixMeta, parent) {
      if (node.type === 'Identifier') {
        if (!isDuplicate(node)) {
          const needPrefix = shouldPrefix(node, parent)
          if (!knownIds[node.name] && needPrefix) {
            if (isPropertyShorthand(node, parent)) {
              // property shorthand like { foo }, we need to add the key since we
              // rewrite the value
              node.prefix = `${node.name}: `
            }
            node.name = `_ctx.${node.name}`
            ids.push(node)
          } else if (!isStaticPropertyKey(node, parent)) {
            // The identifier is considered constant unless it's pointing to a
            // scope variable (a v-for alias, or a v-slot prop)
            if (!(needPrefix && knownIds[node.name]) && !bailConstant) {
              node.isConstant = true
            }
            // also generate sub-expressions for other identifiers for better
            // source map support. (except for property keys which are static)
            ids.push(node)
          }
        }
      } else if (isFunction(node)) {
        // walk function expressions and add its arguments to known identifiers
        // so that we don't prefix them
        node.params.forEach(p =>
          walkJS(p, {
            enter(child, parent) {
              if (
                child.type === 'Identifier' &&
                // do not record as scope variable if is a destructured key
                !isStaticPropertyKey(child, parent) &&
                // do not record if this is a default value
                // assignment of a destructured variable
                !(
                  parent &&
                  parent.type === 'AssignmentPattern' &&
                  parent.right === child
                )
              ) {
                const { name } = child
                if (node.scopeIds && node.scopeIds.has(name)) {
                  return
                }
                if (name in knownIds) {
                  knownIds[name]++
                } else {
                  knownIds[name] = 1
                }
                ;(node.scopeIds || (node.scopeIds = new Set())).add(name)
              }
            }
          })
        )
      }
    },
    leave(node: Node & PrefixMeta) {
      if (node !== ast.body[0].expression && node.scopeIds) {
        node.scopeIds.forEach((id: string) => {
          knownIds[id]--
          if (knownIds[id] === 0) {
            delete knownIds[id]
          }
        })
      }
    }
  })

  // We break up the compound expression into an array of strings and sub
  // expressions (for identifiers that have been prefixed). In codegen, if
  // an ExpressionNode has the `.children` property, it will be used instead of
  // `.content`.
  const children: CompoundExpressionNode['children'] = []
  ids.sort((a, b) => a.start - b.start)
  ids.forEach((id, i) => {
    // range is offset by -1 due to the wrapping parens when parsed
    const start = id.start - 1
    const end = id.end - 1
    const last = ids[i - 1]
    const leadingText = rawExp.slice(last ? last.end - 1 : 0, start)
    if (leadingText.length || id.prefix) {
      children.push(leadingText + (id.prefix || ``))
    }
    const source = rawExp.slice(start, end)
    children.push(
      createSimpleExpression(
        id.name,
        false,
        {
          source,
          start: advancePositionWithClone(node.loc.start, source, start),
          end: advancePositionWithClone(node.loc.start, source, end)
        },
        id.isConstant /* isConstant */
      )
    )
    if (i === ids.length - 1 && end < rawExp.length) {
      children.push(rawExp.slice(end))
    }
  })

  let ret
  if (children.length) {
    ret = createCompoundExpression(children, node.loc)
  } else {
    ret = node
    ret.isConstant = !bailConstant
  }
  ret.identifiers = Object.keys(knownIds)
  return ret
}

const isFunction = (node: Node): node is Function =>
  /Function(Expression|Declaration)$/.test(node.type)

const isStaticProperty = (node: Node): node is ObjectProperty =>
  node && node.type === 'ObjectProperty' && !node.computed

const isPropertyShorthand = (node: Node, parent: Node) => {
  return (
    isStaticProperty(parent) &&
    parent.value === node &&
    parent.key.type === 'Identifier' &&
    parent.key.name === (node as Identifier).name &&
    parent.key.start === node.start
  )
}

const isStaticPropertyKey = (node: Node, parent: Node) =>
  isStaticProperty(parent) && parent.key === node

function shouldPrefix(identifier: Identifier, parent: Node) {
  if (
    !(
      isFunction(parent) &&
      // not id of a FunctionDeclaration
      ((parent as any).id === identifier ||
        // not a params of a function
        parent.params.includes(identifier))
    ) &&
    // not a key of Property
    !isStaticPropertyKey(identifier, parent) &&
    // not a property of a MemberExpression
    !(
      (parent.type === 'MemberExpression' ||
        parent.type === 'OptionalMemberExpression') &&
      parent.property === identifier &&
      !parent.computed
    ) &&
    // not in an Array destructure pattern
    !(parent.type === 'ArrayPattern') &&
    // skip whitelisted globals
    !isGloballyWhitelisted(identifier.name) &&
    // special case for webpack compilation
    identifier.name !== `require` &&
    // is a special keyword but parsed as identifier
    identifier.name !== `arguments`
  ) {
    return true
  }
}
