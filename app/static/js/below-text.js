/**
 * 百度脑图 / DesktopNaotu 插件：在节点“横线”下方添加文本（线下备注）
 *
 * 用法：
 *   1. 选中节点，按 Ctrl+Shift+B（Mac: Cmd+Shift+B），输入文字，确定。
 *      留空并确定 = 删除线下文字。支持多行（文本框里回车换行）。
 *   2. 双击已有的线下文字，可以直接修改。
 *   3. 数据保存在节点 data.belowtext 中，随 .km 文件一起保存，
 *      导出 PNG / SVG 时也会带上。
 *
 * 安装：本文件必须在 kityminder.core.js（vendor.js）之后、
 *       脑图实例创建（index.js）之前加载，例如：
 *       <script src="js/vendor.js"></script>
 *       <script src="js/below-text.js"></script>   <!-- 新增 -->
 *       ...
 *       <script src="index.js"></script>
 */
(function () {
    if (typeof kityminder === 'undefined' || typeof kity === 'undefined') {
        console.error('[below-text] 需要在 kityminder.core.js 之后加载');
        return;
    }

    var DATA_KEY = 'belowtext';
    var GAP = 4;            // 横线与线下文字之间的间距
    var LINE_OFFSET = 3;    // 原版 under 连线画在 box.bottom + 3 处
    var FONT_SCALE = 0.85;  // 线下文字相对节点字号的比例
    var LINE_HEIGHT = 1.4;

    /* ---------------- 命令 ---------------- */
    var BelowTextCommand = kity.createClass('BelowTextCommand', {
        base: kityminder.Command,
        execute: function (minder, text) {
            var nodes = minder.getSelectedNodes();
            text = (text === undefined || text === null) ? '' : String(text);
            nodes.forEach(function (node) {
                node.setData(DATA_KEY, text.replace(/\s+$/, '') || null);
                node.render();
            });
            minder.layout(300);
        },
        queryState: function (minder) {
            return minder.getSelectedNodes().length ? 0 : -1;
        },
        queryValue: function (minder) {
            var node = minder.getSelectedNode();
            return node ? (node.getData(DATA_KEY) || '') : '';
        }
    });

    /* ---------------- 渲染器 ---------------- */
    var BelowTextRenderer = kity.createClass('BelowTextRenderer', {
        base: kityminder.Render,

        create: function (node) {
            var group = new kity.Group().setId('node_belowtext_' + node.getData('id'));
            group.setStyle('cursor', 'text');
            group.on('dblclick', function (e) {
                e.stopPropagation && e.stopPropagation();
                var minder = node.getMinder();
                minder.select(node, true);
                openEditor(minder);
            });
            return group;
        },

        shouldRender: function (node) {
            var has = !!node.getData(DATA_KEY);
            if (!has) node._belowTextExtra = 0;
            return has;
        },

        update: function (group, node, box) {
            var lines = String(node.getData(DATA_KEY)).split('\n');
            var fontSize = Math.round((node.getData('font-size') || node.getStyle('font-size') || 12) * FONT_SCALE);
            var fontFamily = node.getData('font-family') || node.getStyle('font-family');
            // 有底色的节点（如一级节点）文字色可能和画布背景接近，改用连线颜色
            var color = node.getData('belowtext-color') ||
                (node.getType() == 'sub' ? (node.getData('color') || node.getStyle('color')) : node.getStyle('connect-color')) ||
                node.getStyle('color');
            var lineHeight = Math.round(fontSize * LINE_HEIGHT);


            var textX = box.left + (node.getStyle('padding-left') || 0); // 与节点文字左对齐
            group.clear();
            var top = box.bottom + LINE_OFFSET + GAP;
            var maxW = 0;
            lines.forEach(function (line, i) {
                var t = new kity.Text(line || ' ')
                    .setFontSize(fontSize)
                    .setVerticalAlign('top')
                    .setX(textX)
                    .setY(top + i * lineHeight)
                    .fill(color);
                if (fontFamily) t.setFont({ family: fontFamily });
                t.setOpacity(0.85);
                group.addShape(t);
                try { maxW = Math.max(maxW, t.getBoundaryBox().width); } catch (e) {}
            });

            var height = lines.length * lineHeight;
            var extra = LINE_OFFSET + GAP + height;
            node._belowTextExtra = extra;

            // 返回的盒子会并入节点内容盒，布局时自动为线下文字让出空间
            return new kity.Box(textX, box.bottom, maxW, extra);
        }
    });

    /* ---------------- 修正节点的连线锚点（折叠按钮、一级连线）到原文字中线 ---------------- */
    ['getVertexIn', 'getVertexOut'].forEach(function (name) {
        var orig = kityminder.Node.prototype[name];
        kityminder.Node.prototype[name] = function () {
            var p = orig.apply(this, arguments);
            var extra = this._belowTextExtra || 0;
            return extra ? new kity.Point(p.x, p.y - extra / 2) : p;
        };
    });

    /* ---------------- 改写 under 连线：横线画回原文字下方 ---------------- */
    kityminder.Connect.register('under', function (node, parent, connection) {
        var box = node.getLayoutBox(),
            pBox = parent.getLayoutBox();
        var nExtra = node._belowTextExtra || 0;
        var pExtra = parent._belowTextExtra || 0;

        var side = box.x > pBox.x ? 'right' : 'left';
        var underY = box.bottom - nExtra + LINE_OFFSET;
        var startY = parent.getType() == 'sub' ? pBox.bottom - pExtra + LINE_OFFSET : pBox.cy - pExtra / 2;
        var p1, p2, p3, mx;

        if (side == 'right') {
            p1 = new kity.Point(pBox.right, startY);
            p2 = new kity.Point(box.left - 10, underY);
            p3 = new kity.Point(box.right, underY);
        } else {
            p1 = new kity.Point(pBox.left, startY);
            p2 = new kity.Point(box.right + 10, underY);
            p3 = new kity.Point(box.left, underY);
        }
        mx = (p1.x + p2.x) / 2;

        connection.setMarker(null);
        connection.setPathData(['M', p1, 'C', mx, p1.y, mx, p2.y, p2, 'L', p3]);
    });

    /* ---------------- 编辑框 ---------------- */
    function openEditor(minder) {
        if (minder.queryCommandState('belowtext') === -1) return;
        var old = minder.queryCommandValue('belowtext') || '';
        var done = function (val) {
            if (val === null || val === undefined) return; // 取消
            minder.execCommand('belowtext', val);
            minder.focus && minder.focus();
        };
        if (window.bootbox && bootbox.prompt) {
            bootbox.prompt({
                title: '横线下方文字（留空则删除）',
                inputType: 'textarea',
                value: old,
                callback: done
            });
        } else {
            simplePrompt(old, done);
        }
    }

    function simplePrompt(value, cb) {
        var mask = document.createElement('div');
        mask.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;' +
            'background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;';
        mask.innerHTML =
            '<div style="background:#fff;padding:16px;border-radius:6px;width:360px;font-size:14px">' +
            '<div style="margin-bottom:8px">横线下方文字（留空则删除）</div>' +
            '<textarea style="width:100%;height:90px;box-sizing:border-box"></textarea>' +
            '<div style="text-align:right;margin-top:8px">' +
            '<button data-a="0">取消</button> <button data-a="1">确定</button></div></div>';
        var ta = mask.querySelector('textarea');
        ta.value = value;
        mask.addEventListener('click', function (e) {
            var a = e.target.getAttribute && e.target.getAttribute('data-a');
            if (a === null) return;
            document.body.removeChild(mask);
            cb(a === '1' ? ta.value : null);
        });
        ta.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Escape') { document.body.removeChild(mask); cb(null); }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { document.body.removeChild(mask); cb(ta.value); }
        });
        document.body.appendChild(mask);
        ta.focus();
    }

    /* ---------------- 注册模块 ---------------- */
    kityminder.Module.register('BelowTextModule', function () {
        var minder = this;
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'B' || e.key === 'b' || e.keyCode === 66)) {
                e.preventDefault();
                openEditor(minder);
            }
        }, true);
        return {
            commands: { 'belowtext': BelowTextCommand },
            // 注意：不能放在 outside（最后一个）——批量渲染时最后一个渲染器返回的盒子不会被合并
            renderers: { afteroutline: BelowTextRenderer }
        };
    });

    window.kityminderBelowText = { open: openEditor };
})();
