/**
 * 百度脑图 / DesktopNaotu 插件：在节点“横线”下方添加文本（线下备注）
 *
 * 用法：
 *   1. 选中节点，按 Ctrl+Shift+B（Mac: Cmd+Shift+B），输入文字，确定。
 *      留空并确定 = 删除线下文字。支持多行（文本框里回车换行）。
 *   2. 也可以在节点上点右键，在弹出的菜单里选“线下文字”。
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
            return new kity.Group().setId('node_belowtext_' + node.getData('id'));
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

    /* ---------------- 改写 arc 连线（一级节点）：端点对齐原节点中线，而不是含线下文字的整体中线 ---------------- */
    var arcMarker = new kity.Marker().pipe(function () {
        var r = 7;
        var dot = new kity.Circle(r - 1);
        this.addShape(dot);
        this.setRef(r - 1, 0).setViewBox(-r, -r, r + r, r + r).setWidth(r).setHeight(r);
        this.dot = dot;
        this.node.setAttribute('markerUnits', 'userSpaceOnUse');
    });

    kityminder.Connect.register('arc', function (node, parent, connection, width, color) {
        var box = node.getLayoutBox(),
            pBox = parent.getLayoutBox();
        var endY = box.cy - (node._belowTextExtra || 0) / 2;
        var start = new kity.Point(pBox.cx, pBox.cy - (parent._belowTextExtra || 0) / 2);
        var end = box.x > pBox.x ? new kity.Point(box.left - 2, endY) : new kity.Point(box.right + 2, endY);
        var vector = kity.Vector.fromPoints(start, end);

        node.getMinder().getPaper().addResource(arcMarker);
        connection.setMarker(arcMarker);
        arcMarker.dot.fill(color);
        connection.setPathData(['M', start, 'A', Math.abs(vector.x), Math.abs(vector.y), 0, 0,
            vector.x * vector.y > 0 ? 0 : 1, end]);
    });

    /* ---------------- 编辑框 ---------------- */
    // 右键菜单打开时按快捷键，全局监听和菜单按钮会同时触发；只允许一个编辑框
    var editorOpen = false;
    // 编辑框文字的语言跟随编辑器界面；编辑器创建时（见下方右键菜单）设置
    var uiZh = true;

    function openEditor(minder) {
        if (editorOpen) return;
        if (minder.queryCommandState('belowtext') === -1) return;
        editorOpen = true;
        var old = minder.queryCommandValue('belowtext') || '';
        var done = function (val) {
            editorOpen = false;
            if (val === null || val === undefined) return; // 取消
            minder.execCommand('belowtext', val);
            minder.focus && minder.focus();
        };
        if (window.bootbox && bootbox.prompt) {
            var $dialog = bootbox.prompt({
                title: uiZh ? '横线下方文字（留空则删除）' : 'Text below the line (leave empty to delete)',
                inputType: 'textarea',
                value: old,
                buttons: {
                    cancel: { label: uiZh ? '取消' : 'Cancel' },
                    confirm: { label: uiZh ? '确定' : 'OK' }
                },
                callback: done
            });
            placeNearNode($dialog, minder.getSelectedNode());
        } else {
            simplePrompt(old, done);
        }
    }

    // Bootstrap 默认把对话框放在窗口顶部，离节点很远。改为放在节点下方；放不下就放在上方
    var DIALOG_WIDTH = 420;
    var DIALOG_GAP = 12;
    var VIEW_MARGIN = 10;

    function placeNearNode($dialog, node) {
        if (!$dialog || !$dialog.find || !node) return;
        var box = $dialog.find('.modal-dialog')[0];
        if (!box) return;
        var r = node.getRenderContainer().node.getBoundingClientRect();
        var vw = window.innerWidth, vh = window.innerHeight;
        var width = Math.min(DIALOG_WIDTH, vw - VIEW_MARGIN * 2);
        box.style.position = 'absolute';
        box.style.margin = '0';
        box.style.width = width + 'px';
        // 对话框要等遮罩动画结束才显示，此时还是 display:none，量不到高度。临时以不可见方式显示来测量
        var modal = $dialog[0];
        var prevDisplay = modal.style.display, prevVisibility = modal.style.visibility;
        modal.style.visibility = 'hidden';
        modal.style.display = 'block';
        var height = box.offsetHeight;
        modal.style.display = prevDisplay;
        modal.style.visibility = prevVisibility;
        var top = r.bottom + DIALOG_GAP;
        if (top + height > vh - VIEW_MARGIN) {
            top = r.top - DIALOG_GAP - height;
        }
        top = Math.max(VIEW_MARGIN, Math.min(top, vh - VIEW_MARGIN - height));
        var left = Math.max(VIEW_MARGIN, Math.min(r.left, vw - VIEW_MARGIN - width));
        box.style.left = left + 'px';
        box.style.top = top + 'px';
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

    /* ---------------- 右键菜单（hotbox）按钮 ---------------- */
    if (kityminder.Editor && kityminder.Editor.assemble) {
        kityminder.Editor.assemble(function () {
            var minder = this.minder;
            var fsm = this.fsm;
            // 编辑器语言没有公开的读取方法；用一个内置词条判断当前是否为中文界面
            var zh = uiZh = /[一-龥]/.test(this.lang.t('appendchildnode', 'runtime/node'));
            // 环形按钮直径只有 70px，默认字号放不下这个按钮的文字，所以单独缩小
            var style = document.createElement('style');
            style.textContent =
                '.hotbox .state .ring .button .belowtext-label{font-size:13px;margin-top:20px}' +
                '.hotbox .state .ring .button .belowtext-key{font-size:9px;letter-spacing:-0.2px}';
            document.head.appendChild(style);
            this.hotbox.state('main').button({
                position: 'ring',
                label: zh ? '线下文字' : 'Below text',
                key: 'Ctrl+Shift+B',
                render: function (format, option) {
                    return format('<span class="label belowtext-label">{label}</span>' +
                        '<span class="key belowtext-key">{key}</span>', option);
                },
                action: function () {
                    fsm.jump('normal', 'command-executed');
                    openEditor(minder);
                },
                enable: function () {
                    return minder.queryCommandState('belowtext') != -1;
                }
            });
        });
    } else {
        console.error('[below-text] kityminder.Editor.assemble 不存在，右键菜单按钮未添加');
    }

    window.kityminderBelowText = { open: openEditor };
})();
