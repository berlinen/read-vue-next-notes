import { ParserOptions } from './options'
import { NO, isArray, makeMap } from '@vue/shared'
import { ErrorCodes, createCompilerError, defaultOnError } from './errors'
import {
  assert,
  advancePositionWithMutation,
  advancePositionWithClone,
  isCoreComponent
} from './utils'
import {
  Namespaces,
  AttributeNode,
  CommentNode,
  DirectiveNode,
  ElementNode,
  ElementTypes,
  ExpressionNode,
  NodeTypes,
  Position,
  RootNode,
  SourceLocation,
  TextNode,
  TemplateChildNode,
  InterpolationNode,
  createRoot
} from './ast'
import { extend } from '@vue/shared'

type OptionalOptions = 'isNativeTag' | 'isBuiltInComponent'
type MergedParserOptions = Omit<Required<ParserOptions>, OptionalOptions> &
  Pick<ParserOptions, OptionalOptions>

// The default decoder only provides escapes for characters reserved as part of
// the tempalte syntax, and is only used if the custom renderer did not provide
// a platform-specific decoder.
const decodeRE = /&(gt|lt|amp|apos|quot);/g
const decodeMap: Record<string, string> = {
  gt: '>',
  lt: '<',
  amp: '&',
  apos: "'",
  quot: '"'
}
// // 创建解析上下文  默认解析配置
export const defaultParserOptions: MergedParserOptions = {
  delimiters: [`{{`, `}}`],
  getNamespace: () => Namespaces.HTML,
  getTextMode: () => TextModes.DATA,
  isVoidTag: NO,
  isPreTag: NO,
  isCustomElement: NO,
  decodeEntities: (rawText: string): string =>
    rawText.replace(decodeRE, (_, p1) => decodeMap[p1]),
  onError: defaultOnError
}

export const enum TextModes {
  //          | Elements | Entities | End sign              | Inside of
  DATA, //    | ✔       | ✔       | End tags of ancestors |
  RCDATA, //  | ✘       | ✔       | End tag of the parent | <textarea>
  RAWTEXT, // | ✘       | ✘       | End tag of the parent | <style>,<script>
  CDATA,
  ATTRIBUTE_VALUE
}

export interface ParserContext {
  options: MergedParserOptions
  readonly originalSource: string
  source: string
  offset: number
  line: number
  column: number
  inPre: boolean // HTML <pre> tag, preserve whitespaces
  inVPre: boolean // v-pre, do not process directives and interpolations
}
/**
 * @description
 * 生成 AST虚拟根节点
 * 1. 创建解析上下文
 * 2. 解析子节点
 * 3. 创建AST根节点
 * @param content
 * @param options
 */
export function baseParse(
  content: string,
  options: ParserOptions = {}
): RootNode {
  // // 创建解析上下文
  const context = createParserContext(content, options)
  const start = getCursor(context)
  // 解析子节点，并创建 AST
  return createRoot(
    parseChildren(context, TextModes.DATA, []),
    getSelection(context, start)
  )
}
/**
 * @description
 * 创建解析上下文
 * 解析上下文实际上就是一个 JavaScript 对象，它维护着解析过程中的上下文，其中 options 表示解析相关配置 ，column 表示当前代码的列号，line 表示当前代码的行号，originalSource 表示最初的原始代码，source 表示当前代码，offset 表示当前代码相对于原始代码的偏移量，inPre 表示当前代码是否在 pre 标签内，inVPre 表示当前代码是否在 v-pre 指令的环境下。
 * @param content
 * @param options
 */
function createParserContext(
  content: string,
  options: ParserOptions
): ParserContext {
  return {
    // 解析相关配置
    options: {
      ...defaultParserOptions,
      ...options
    },
    column: 1, // 示当前代码的列号
    line: 1, //  表示当前代码的行号
    offset: 0, // 表示当前代码相对于原始代码的偏移量
    originalSource: content, // 表示最初的原始代码
    source: content, // 表示当前代码，
    inPre: false, // inPre 表示当前代码是否在 pre 标签内
    inVPre: false //表示当前代码是否在 v-pre 指令的环境下
  }
}
/**
 * @description
 * 解析子节点
 * parseChildren 的目的就是解析并创建 AST 节点数组。它有两个主要流程，
 * 1. 自顶向下分析代码，生成 AST 节点数组 nodes；
 * 2. 空白字符管理，用于提高编译的效率
 * @param context
 * @param mode
 * @param ancestors
 */
function parseChildren(
  context: ParserContext,
  mode: TextModes,
  ancestors: ElementNode[]
): TemplateChildNode[] {
  // 父节点
  const parent = last(ancestors)
  const ns = parent ? parent.ns : Namespaces.HTML /* html */
  const nodes: TemplateChildNode[] = []

   // 自顶向下分析代码，生成 nodes
  // 判断是否遍历结束
  while (!isEnd(context, mode, ancestors)) {
    __TEST__ && assert(context.source.length > 0)
    const s = context.source
    let node: TemplateChildNode | TemplateChildNode[] | undefined = undefined

    if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
      if (!context.inVPre && startsWith(s, context.options.delimiters[0])) {
        // '{{'
        // 处理 {{ 插值代码
        node = parseInterpolation(context, mode)
         // 处理 < 开头的代码
      } else if (mode === TextModes.DATA && s[0] === '<') {
        // https://html.spec.whatwg.org/multipage/parsing.html#tag-open-state
         // s 长度为 1，说明代码结尾是 <，报错
        if (s.length === 1) {
          emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 1)
        } else if (s[1] === '!') {
          // https://html.spec.whatwg.org/multipage/parsing.html#markup-declaration-open-state
          // 处理 <! 开头的代码
          if (startsWith(s, '<!--')) {
            // 处理注释节点
            node = parseComment(context)
          } else if (startsWith(s, '<!DOCTYPE')) {
            // Ignore DOCTYPE by a limitation.
            // 处理 <!DOCTYPE 节点
            node = parseBogusComment(context)
          } else if (startsWith(s, '<![CDATA[')) {
            // 处理 <![CDATA[ 节点
            if (ns !== Namespaces.HTML) {
              node = parseCDATA(context, ancestors)
            } else {
              emitError(context, ErrorCodes.CDATA_IN_HTML_CONTENT)
              node = parseBogusComment(context)
            }
          } else {
            emitError(context, ErrorCodes.INCORRECTLY_OPENED_COMMENT)
            node = parseBogusComment(context)
          }
           // 处理 </ 结束标签
        } else if (s[1] === '/') {
          // https://html.spec.whatwg.org/multipage/parsing.html#end-tag-open-state
          // s 长度为 2，说明代码结尾是 </，报错
          if (s.length === 2) {
            emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 2)
             // </> 缺少结束标签，报错
          } else if (s[2] === '>') {
            emitError(context, ErrorCodes.MISSING_END_TAG_NAME, 2)
            advanceBy(context, 3)
            continue
            // 多余的结束标签
          } else if (/[a-z]/i.test(s[2])) {
            emitError(context, ErrorCodes.X_INVALID_END_TAG)
            parseTag(context, TagType.End, parent)
            continue
          } else {
            emitError(
              context,
              ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME,
              2
            )
            node = parseBogusComment(context)
          }
        } else if (/[a-z]/i.test(s[1])) {
          // 解析标签元素节点
          node = parseElement(context, ancestors)
        } else if (s[1] === '?') {
          emitError(
            context,
            ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
            1
          )
          node = parseBogusComment(context)
        } else {
          emitError(context, ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME, 1)
        }
      }
    }
    if (!node) {
      // 解析普通文本节点
      node = parseText(context, mode)
    }

    if (isArray(node)) {
      // 如果 node 是数组，则遍历添加
      for (let i = 0; i < node.length; i++) {
        pushNode(nodes, node[i])
      }
    } else {
       // 添加单个 node
      pushNode(nodes, node)
    }
  }

  // Whitespace management for more efficient output
  // (same as v2 whitespace: 'condense')
  // removedWhitespace  // 空白字符管理
  let removedWhitespace = false
  if (mode !== TextModes.RAWTEXT) {
    if (!context.inPre) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node.type === NodeTypes.TEXT) {
          if (!/[^\t\r\n\f ]/.test(node.content)) {
            // 匹配空白字符
            const prev = nodes[i - 1]
            const next = nodes[i + 1]
            // If:
            // - the whitespace is the first or last node, or:
            // - the whitespace is adjacent to a comment, or:
            // - the whitespace is between two elements AND contains newline
            // Then the whitespace is ignored.
            // 如果空白字符是开头或者结尾节点
            // 或者空白字符与注释节点相连
            // 或者空白字符在两个元素之间并包含换行符
            // 那么这些空白字符节点都应该被移除
            if (
              !prev ||
              !next ||
              prev.type === NodeTypes.COMMENT ||
              next.type === NodeTypes.COMMENT ||
              (prev.type === NodeTypes.ELEMENT &&
                next.type === NodeTypes.ELEMENT &&
                /[\r\n]/.test(node.content))
            ) {
              removedWhitespace = true
              nodes[i] = null as any
            } else {
              // Otherwise, condensed consecutive whitespace inside the text down to
              // a single space
              // 否则压缩这些空白字符到一个空格
              node.content = ' '
            }
          } else {
            // 替换内容中的空白空间到一个空格
            node.content = node.content.replace(/[\t\r\n\f ]+/g, ' ')
          }
        }
      }
    } else if (parent && context.options.isPreTag(parent.tag)) {
      // 生产环境移除注释节点
      // remove leading newline per html spec
      // https://html.spec.whatwg.org/multipage/grouping-content.html#the-pre-element
      const first = nodes[0]
      // 根据 HTML 规范删除前导换行符
      if (first && first.type === NodeTypes.TEXT) {
        first.content = first.content.replace(/^\r?\n/, '')
      }
    }
  }
  // 过滤空白字符节点
  return removedWhitespace ? nodes.filter(Boolean) : nodes
}

function pushNode(nodes: TemplateChildNode[], node: TemplateChildNode): void {
  // ignore comments in production
  /* istanbul ignore next */
  if (!__DEV__ && node.type === NodeTypes.COMMENT) {
    return
  }

  if (node.type === NodeTypes.TEXT) {
    const prev = last(nodes)
    // Merge if both this and the previous node are text and those are
    // consecutive. This happens for cases like "a < b".
    if (
      prev &&
      prev.type === NodeTypes.TEXT &&
      prev.loc.end.offset === node.loc.start.offset
    ) {
      prev.content += node.content
      prev.loc.end = node.loc.end
      prev.loc.source += node.loc.source
      return
    }
  }

  nodes.push(node)
}

function parseCDATA(
  context: ParserContext,
  ancestors: ElementNode[]
): TemplateChildNode[] {
  __TEST__ &&
    assert(last(ancestors) == null || last(ancestors)!.ns !== Namespaces.HTML)
  __TEST__ && assert(startsWith(context.source, '<![CDATA['))

  advanceBy(context, 9)
  const nodes = parseChildren(context, TextModes.CDATA, ancestors)
  if (context.source.length === 0) {
    emitError(context, ErrorCodes.EOF_IN_CDATA)
  } else {
    __TEST__ && assert(startsWith(context.source, ']]>'))
    advanceBy(context, 3)
  }

  return nodes
}
/**
 * @description
 * 注释节点的解析
 * 即当前代码 s 是以 <!-- 开头的字符串，则走到注释节点的解析处理逻辑。
 * parseComment 的实现很简单，首先它会利用注释结束符的正则表达式去匹配代码，找出注释结束符。如果没有匹配到或者注释结束符不合法，都会报错。
 * 如果找到合法的注释结束符，则获取它中间的注释内容 content，然后截取注释开头到结尾之间的代码，并判断是否有嵌套注释，如果有嵌套注释也会报错。
 * 接着就是通过调用 advanceBy 前进代码到注释结束符后，这个函数在整个模板解析过程中经常被调用，它的目的是用来前进代码，更新 context 解析上下文，
 * @param context
 */
function parseComment(context: ParserContext): CommentNode {
  __TEST__ && assert(startsWith(context.source, '<!--'))

  const start = getCursor(context)
  let content: string

  // Regular comment.
  //  // 常规注释的结束符
  const match = /--(\!)?>/.exec(context.source) /** /--(\!)?/.exec(content.source) */
  //// 没有匹配的注释结束符
  if (!match) {
    content = context.source.slice(4)
    advanceBy(context, context.source.length)
    emitError(context, ErrorCodes.EOF_IN_COMMENT)
  } else {
    // 非法的注释符号
    if (match.index <= 3) {
      emitError(context, ErrorCodes.ABRUPT_CLOSING_OF_EMPTY_COMMENT)
    }
   // 注释结束符不正确
    if (match[1]) {
      emitError(context, ErrorCodes.INCORRECTLY_CLOSED_COMMENT)
    }
    // 获取注释的内容
    content = context.source.slice(4, match.index)

    // Advancing with reporting nested comments.
    // 截取到注释结尾之间的代码，用于后续判断嵌套注释
    const s = context.source.slice(0, match.index)
    let prevIndex = 1,
      nestedIndex = 0
    // 判断嵌套注释符的情况，存在即报错
    while ((nestedIndex = s.indexOf('<!--', prevIndex)) !== -1) {
      advanceBy(context, nestedIndex - prevIndex + 1)
      if (nestedIndex + 4 < s.length) {
        emitError(context, ErrorCodes.NESTED_COMMENT)
      }
      prevIndex = nestedIndex + 1
    }
    // 前进代码到注释结束符后
    advanceBy(context, match.index + match[0].length - prevIndex + 1)
  }

  return {
    type: NodeTypes.COMMENT, // 3 一个注释节点
    content, // 表示注释的内容
    loc: getSelection(context, start) // loc 表示注释的代码开头和结束的位置信息
  }
}

function parseBogusComment(context: ParserContext): CommentNode | undefined {
  __TEST__ && assert(/^<(?:[\!\?]|\/[^a-z>])/i.test(context.source))

  const start = getCursor(context)
  const contentStart = context.source[1] === '?' ? 1 : 2
  let content: string

  const closeIndex = context.source.indexOf('>')
  if (closeIndex === -1) {
    content = context.source.slice(contentStart)
    advanceBy(context, context.source.length)
  } else {
    content = context.source.slice(contentStart, closeIndex)
    advanceBy(context, closeIndex + 1)
  }

  return {
    type: NodeTypes.COMMENT,
    content,
    loc: getSelection(context, start)
  }
}
/**
 * @description
 * 解析元素
 * 1 解析开始标签，
 * 2 解析子节点，
 * 3 解析闭合标签。
 * @param context
 * @param ancestors
 */
function parseElement(
  context: ParserContext,
  ancestors: ElementNode[]
): ElementNode | undefined {
  __TEST__ && assert(/^<[a-z]/i.test(context.source))

  // Start tag.
  // 是否在 pre 标签内
  const wasInPre = context.inPre
  // 是否在 v-pre 指令内
  const wasInVPre = context.inVPre
  // 获取当前元素的父标签节点
  const parent = last(ancestors)
  // 解析开始标签，生成一个标签节点，并前进代码到开始标签后
  const element = parseTag(context, TagType.Start, parent)
  // 是否在 pre 标签的边界
  const isPreBoundary = context.inPre && !wasInPre
   // 是否在 v-pre 指令的边界
  const isVPreBoundary = context.inVPre && !wasInVPre

  if (element.isSelfClosing || context.options.isVoidTag(element.tag)) {
    // 如果是自闭和标签，直接返回标签节点
    return element
  }

  // Children.
  // 下面是处理子节点的逻辑
  // 先把标签节点添加到 ancestors，入栈
  ancestors.push(element)
  const mode = context.options.getTextMode(element.tag, element.ns, parent)
   // 递归解析子节点，传入 ancestors
  const children = parseChildren(context, mode, ancestors)
  // ancestors 出栈
  ancestors.pop()
  // 添加到 children 属性中
  element.children = children

  // End tag.
   // 结束标签
  if (startsWithEndTagOpen(context.source, element.tag)) {
    // 解析结束标签，并前进代码到结束标签后
    parseTag(context, TagType.End, parent)
  } else {
    emitError(context, ErrorCodes.X_MISSING_END_TAG, 0, element.loc.start)
    if (context.source.length === 0 && element.tag.toLowerCase() === 'script') {
      const first = children[0]
      if (first && startsWith(first.loc.source, '<!--')) {
        emitError(context, ErrorCodes.EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT)
      }
    }
  }
  // 更新标签节点的代码位置，结束位置到结束标签后
  element.loc = getSelection(context, element.loc.start)

  if (isPreBoundary) {
    context.inPre = false
  }
  if (isVPreBoundary) {
    context.inVPre = false
  }
  return element
}

const enum TagType {
  Start,
  End
}

const isSpecialTemplateDirective = /*#__PURE__*/ makeMap(
  `if,else,else-if,for,slot`
)

/**
 * @description
 * 解析开始标签的过程
 * Parse a tag (E.g. `<div id=a>`) with that type (start tag or end tag).
 */
function parseTag(
  context: ParserContext,
  type: TagType,
  parent: ElementNode | undefined
): ElementNode {
  __TEST__ && assert(/^<\/?[a-z]/i.test(context.source))
  __TEST__ &&
    assert(
      type === (startsWith(context.source, '</') ? TagType.End : TagType.Start)
    )

  // Tag open.
  // 标签打开
  const start = getCursor(context)
  // 匹配标签文本结束的位置
  const match = /^<\/?([a-z][^\t\r\n\f />]*)/i.exec(context.source)!
  const tag = match[1]
  const ns = context.options.getNamespace(tag, parent)
  // 前进代码到标签文本结束位置
  advanceBy(context, match[0].length)
  // 前进代码到标签文本后面的空白字符后
  advanceSpaces(context)

  // save current state in case we need to re-parse attributes with v-pre
  // 保存当前状态以防我们需要用 v-pre 重新解析属性
  const cursor = getCursor(context)
  const currentSource = context.source

  // Attributes.
  // 解析标签中的属性，并前进代码到属性后
  let props = parseAttributes(context, type)

  // check <pre> tag
  // 检查是不是一个 pre 标签
  if (context.options.isPreTag(tag)) {
    context.inPre = true
  }

  // check v-pre
  // 检查属性中有没有 v-pre 指令
  if (
    !context.inVPre &&
    props.some(p => p.type === NodeTypes.DIRECTIVE && p.name === 'pre')
  ) {
    context.inVPre = true
    // reset context
    // 重置 context
    extend(context, cursor)
    context.source = currentSource
    // re-parse attrs and filter out v-pre itself
    // 重新解析属性，并把 v-pre 过滤了
    props = parseAttributes(context, type).filter(p => p.name !== 'v-pre')
  }

  // Tag close.
  // 标签闭合
  let isSelfClosing = false

  if (context.source.length === 0) {
    emitError(context, ErrorCodes.EOF_IN_TAG)
  } else {
    // 判断是否自闭合标签
    isSelfClosing = startsWith(context.source, '/>')
    if (type === TagType.End && isSelfClosing) {
      // 结束标签不应该是自闭和标签
      emitError(context, ErrorCodes.END_TAG_WITH_TRAILING_SOLIDUS)
    }
     // 前进代码到闭合标签后
    advanceBy(context, isSelfClosing ? 2 : 1)
  }

  let tagType = ElementTypes.ELEMENT
  const options = context.options
  if (!context.inVPre && !options.isCustomElement(tag)) {
    const hasVIs = props.some(
      p => p.type === NodeTypes.DIRECTIVE && p.name === 'is'
    )
    // 接下来判断标签类型，是组件、插槽还是模板
    if (options.isNativeTag && !hasVIs) {
      if (!options.isNativeTag(tag)) tagType = ElementTypes.COMPONENT
    } else if (
       // 判断是否有 is 属性
      hasVIs ||
      isCoreComponent(tag) ||
      (options.isBuiltInComponent && options.isBuiltInComponent(tag)) ||
      /^[A-Z]/.test(tag) ||
      tag === 'component'
    ) {
      tagType = ElementTypes.COMPONENT
    }

    if (tag === 'slot') {
      tagType = ElementTypes.SLOT
    } else if (
      tag === 'template' &&
      props.some(p => {
        return (
          p.type === NodeTypes.DIRECTIVE && isSpecialTemplateDirective(p.name)
        )
      })
    ) {
      tagType = ElementTypes.TEMPLATE
    }
  }

  return {
    type: NodeTypes.ELEMENT,
    ns,
    tag,
    tagType,
    props,
    isSelfClosing,
    children: [],
    loc: getSelection(context, start),
    codegenNode: undefined // to be created during transform phase
  }
}

function parseAttributes(
  context: ParserContext,
  type: TagType
): (AttributeNode | DirectiveNode)[] {
  const props = []
  const attributeNames = new Set<string>()
  while (
    context.source.length > 0 &&
    !startsWith(context.source, '>') &&
    !startsWith(context.source, '/>')
  ) {
    if (startsWith(context.source, '/')) {
      emitError(context, ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG)
      advanceBy(context, 1)
      advanceSpaces(context)
      continue
    }
    if (type === TagType.End) {
      emitError(context, ErrorCodes.END_TAG_WITH_ATTRIBUTES)
    }

    const attr = parseAttribute(context, attributeNames)
    if (type === TagType.Start) {
      props.push(attr)
    }

    if (/^[^\t\r\n\f />]/.test(context.source)) {
      emitError(context, ErrorCodes.MISSING_WHITESPACE_BETWEEN_ATTRIBUTES)
    }
    advanceSpaces(context)
  }
  return props
}

function parseAttribute(
  context: ParserContext,
  nameSet: Set<string>
): AttributeNode | DirectiveNode {
  __TEST__ && assert(/^[^\t\r\n\f />]/.test(context.source))

  // Name.
  const start = getCursor(context)
  const match = /^[^\t\r\n\f />][^\t\r\n\f />=]*/.exec(context.source)!
  const name = match[0]

  if (nameSet.has(name)) {
    emitError(context, ErrorCodes.DUPLICATE_ATTRIBUTE)
  }
  nameSet.add(name)

  if (name[0] === '=') {
    emitError(context, ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME)
  }
  {
    const pattern = /["'<]/g
    let m: RegExpExecArray | null
    while ((m = pattern.exec(name))) {
      emitError(
        context,
        ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
        m.index
      )
    }
  }

  advanceBy(context, name.length)

  // Value
  let value:
    | {
        content: string
        isQuoted: boolean
        loc: SourceLocation
      }
    | undefined = undefined

  if (/^[\t\r\n\f ]*=/.test(context.source)) {
    advanceSpaces(context)
    advanceBy(context, 1)
    advanceSpaces(context)
    value = parseAttributeValue(context)
    if (!value) {
      emitError(context, ErrorCodes.MISSING_ATTRIBUTE_VALUE)
    }
  }
  const loc = getSelection(context, start)

  if (!context.inVPre && /^(v-|:|@|#)/.test(name)) {
    const match = /(?:^v-([a-z0-9-]+))?(?:(?::|^@|^#)([^\.]+))?(.+)?$/i.exec(
      name
    )!

    let arg: ExpressionNode | undefined

    if (match[2]) {
      const startOffset = name.indexOf(match[2])
      const loc = getSelection(
        context,
        getNewPosition(context, start, startOffset),
        getNewPosition(context, start, startOffset + match[2].length)
      )
      let content = match[2]
      let isStatic = true

      if (content.startsWith('[')) {
        isStatic = false

        if (!content.endsWith(']')) {
          emitError(
            context,
            ErrorCodes.X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END
          )
        }

        content = content.substr(1, content.length - 2)
      }

      arg = {
        type: NodeTypes.SIMPLE_EXPRESSION,
        content,
        isStatic,
        isConstant: isStatic,
        loc
      }
    }

    if (value && value.isQuoted) {
      const valueLoc = value.loc
      valueLoc.start.offset++
      valueLoc.start.column++
      valueLoc.end = advancePositionWithClone(valueLoc.start, value.content)
      valueLoc.source = valueLoc.source.slice(1, -1)
    }

    return {
      type: NodeTypes.DIRECTIVE,
      name:
        match[1] ||
        (startsWith(name, ':')
          ? 'bind'
          : startsWith(name, '@')
            ? 'on'
            : 'slot'),
      exp: value && {
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: value.content,
        isStatic: false,
        // Treat as non-constant by default. This can be potentially set to
        // true by `transformExpression` to make it eligible for hoisting.
        isConstant: false,
        loc: value.loc
      },
      arg,
      modifiers: match[3] ? match[3].substr(1).split('.') : [],
      loc
    }
  }

  return {
    type: NodeTypes.ATTRIBUTE,
    name,
    value: value && {
      type: NodeTypes.TEXT,
      content: value.content,
      loc: value.loc
    },
    loc
  }
}

function parseAttributeValue(
  context: ParserContext
):
  | {
      content: string
      isQuoted: boolean
      loc: SourceLocation
    }
  | undefined {
  const start = getCursor(context)
  let content: string

  const quote = context.source[0]
  const isQuoted = quote === `"` || quote === `'`
  if (isQuoted) {
    // Quoted value.
    advanceBy(context, 1)

    const endIndex = context.source.indexOf(quote)
    if (endIndex === -1) {
      content = parseTextData(
        context,
        context.source.length,
        TextModes.ATTRIBUTE_VALUE
      )
    } else {
      content = parseTextData(context, endIndex, TextModes.ATTRIBUTE_VALUE)
      advanceBy(context, 1)
    }
  } else {
    // Unquoted
    const match = /^[^\t\r\n\f >]+/.exec(context.source)
    if (!match) {
      return undefined
    }
    const unexpectedChars = /["'<=`]/g
    let m: RegExpExecArray | null
    while ((m = unexpectedChars.exec(match[0]))) {
      emitError(
        context,
        ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
        m.index
      )
    }
    content = parseTextData(context, match[0].length, TextModes.ATTRIBUTE_VALUE)
  }

  return { content, isQuoted, loc: getSelection(context, start) }
}
/**
 * @desc
 * 插值的解析
 * 首先它会尝试找插值的结束分隔符，如果找不到则报错
 *
 * @param context
 * @param mode
 */
function parseInterpolation(
  context: ParserContext,
  mode: TextModes
): InterpolationNode | undefined {
  // 从配置中获取插值开始和结束分隔符，默认是 {{ 和 }}
  const [open, close] = context.options.delimiters
  __TEST__ && assert(startsWith(context.source, open))

  const closeIndex = context.source.indexOf(close, open.length)
  if (closeIndex === -1) {
    emitError(context, ErrorCodes.X_MISSING_INTERPOLATION_END)
    return undefined
  }

  const start = getCursor(context)
  // 代码前进到插值开始分隔符后
  advanceBy(context, open.length)
  // 内部插值开始位置
  const innerStart = getCursor(context)
  // 内部插值结束位置
  const innerEnd = getCursor(context)
  // 插值原始内容的长度
  const rawContentLength = closeIndex - open.length
  // 插值原始内容
  const rawContent = context.source.slice(0, rawContentLength)
  // 获取插值的内容，并前进代码到插值的内容后
  const preTrimContent = parseTextData(context, rawContentLength, mode)
  const content = preTrimContent.trim()
  // 内容相对于插值开始分隔符的头偏移
  const startOffset = preTrimContent.indexOf(content)
  if (startOffset > 0) {
    // 更新内部插值开始位置
    advancePositionWithMutation(innerStart, rawContent, startOffset)
  }
  // 内容相对于插值结束分隔符的尾偏移
  const endOffset =
    rawContentLength - (preTrimContent.length - content.length - startOffset)
  // 更新内部插值结束位置
  advancePositionWithMutation(innerEnd, rawContent, endOffset)
  // 前进代码到插值结束分隔符后
  advanceBy(context, close.length)

  return {
    type: NodeTypes.INTERPOLATION, // 一个插值节点
    // 描述表达式节点的对象
    content: {
      type: NodeTypes.SIMPLE_EXPRESSION, // 示它是一个表达式节点
      isStatic: false,
      // Set `isConstant` to false by default and will decide in transformExpression
      isConstant: false,
      content, // content 表示插值的内容。
      loc: getSelection(context, innerStart, innerEnd) // loc 表示内容的代码开头和结束的位置信息
    },
    loc: getSelection(context, start) // 表示插值的代码开头和结束的位置信息
  }
}
/**
 * @description
 * 普通文本的解析
 *
 * @param context
 * @param mode
 */
function parseText(context: ParserContext, mode: TextModes): TextNode {
  __TEST__ && assert(context.source.length > 0)
 // 文本结束符
  const endTokens = ['<', context.options.delimiters[0]]
  if (mode === TextModes.CDATA) {
    endTokens.push(']]>')
  }

  let endIndex = context.source.length
  // 遍历文本结束符，匹配找到结束的位置
  for (let i = 0; i < endTokens.length; i++) {
    const index = context.source.indexOf(endTokens[i], 1)
    if (index !== -1 && endIndex > index) {
      endIndex = index
    }
  }

  __TEST__ && assert(endIndex > 0)

  const start = getCursor(context)
  // 获取文本的内容，并前进代码到文本的内容后
  const content = parseTextData(context, endIndex, mode)

  return {
    type: NodeTypes.TEXT, //type 表示它是一个文本节点
    content, //表示文本的内容，
    loc: getSelection(context, start) // 表示文本的代码开头和结束的位置信息。
  }
}

/**
 * Get text data with a given length from the current location.
 * This translates HTML entities in the text data.
 */
function parseTextData(
  context: ParserContext,
  length: number,
  mode: TextModes
): string {
  const rawText = context.source.slice(0, length)
  advanceBy(context, length)
  if (
    mode === TextModes.RAWTEXT ||
    mode === TextModes.CDATA ||
    rawText.indexOf('&') === -1
  ) {
    return rawText
  } else {
    // DATA or RCDATA containing "&"". Entity decoding required.
    return context.options.decodeEntities(
      rawText,
      mode === TextModes.ATTRIBUTE_VALUE
    )
  }
}

function getCursor(context: ParserContext): Position {
  const { column, line, offset } = context
  return { column, line, offset }
}

function getSelection(
  context: ParserContext,
  start: Position,
  end?: Position
): SourceLocation {
  end = end || getCursor(context)
  return {
    start,
    end,
    source: context.originalSource.slice(start.offset, end.offset)
  }
}

function last<T>(xs: T[]): T | undefined {
  return xs[xs.length - 1]
}

function startsWith(source: string, searchString: string): boolean {
  return source.startsWith(searchString)
}
/**
 * @description
 *  advanceBy 这个函数在整个模板解析过程中经常被调用，它的目的是用来前进代码，更新 context 解析上下文，
 *  主要就是更新解析上下文 context 中的 source 来前进代码，同时更新 offset、line、column 等和代码位置相关的属性。
 * @param context
 * @param numberOfCharacters
 */
function advanceBy(context: ParserContext, numberOfCharacters: number): void {
  const { source } = context
  __TEST__ && assert(numberOfCharacters <= source.length)
  // 更新 context 的 offset、line、column
  advancePositionWithMutation(context, source, numberOfCharacters)
  // 更新 context 的 source
  context.source = source.slice(numberOfCharacters)
}

function advanceSpaces(context: ParserContext): void {
  const match = /^[\t\r\n\f ]+/.exec(context.source)
  if (match) {
    advanceBy(context, match[0].length)
  }
}

function getNewPosition(
  context: ParserContext,
  start: Position,
  numberOfCharacters: number
): Position {
  return advancePositionWithClone(
    start,
    context.originalSource.slice(start.offset, numberOfCharacters),
    numberOfCharacters
  )
}

function emitError(
  context: ParserContext,
  code: ErrorCodes,
  offset?: number,
  loc: Position = getCursor(context)
): void {
  if (offset) {
    loc.offset += offset
    loc.column += offset
  }
  context.options.onError(
    createCompilerError(code, {
      start: loc,
      end: loc,
      source: ''
    })
  )
}

function isEnd(
  context: ParserContext,
  mode: TextModes,
  ancestors: ElementNode[]
): boolean {
  const s = context.source

  switch (mode) {
    case TextModes.DATA:
      if (startsWith(s, '</')) {
        //TODO: probably bad performance
        for (let i = ancestors.length - 1; i >= 0; --i) {
          if (startsWithEndTagOpen(s, ancestors[i].tag)) {
            return true
          }
        }
      }
      break

    case TextModes.RCDATA:
    case TextModes.RAWTEXT: {
      const parent = last(ancestors)
      if (parent && startsWithEndTagOpen(s, parent.tag)) {
        return true
      }
      break
    }

    case TextModes.CDATA:
      if (startsWith(s, ']]>')) {
        return true
      }
      break
  }

  return !s
}

function startsWithEndTagOpen(source: string, tag: string): boolean {
  return (
    startsWith(source, '</') &&
    source.substr(2, tag.length).toLowerCase() === tag.toLowerCase() &&
    /[\t\n\f />]/.test(source[2 + tag.length] || '>')
  )
}
