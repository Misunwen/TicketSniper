// =========================================================================
// MAIN world 反偵測（由 manifest content_scripts 以 world: MAIN 注入）
// 必須在 MAIN world 才能覆寫頁面自己的 Event.prototype，讓頁面看到的事件
// isTrusted 一律為 true。content script 位於 ISOLATED world，兩者互不影響，
// 因此 content.js 仍可透過原生 getter 判斷是否為真人操作。
// =========================================================================
(function () {
    try {
        const _origAdd = EventTarget.prototype.addEventListener;
        const _origRemove = EventTarget.prototype.removeEventListener;

        function makeNativeLike(fn, name) {
            try {
                Object.defineProperty(fn, 'name', { value: name, configurable: true });
            } catch (e) {}
            try {
                fn.toString = function () { return `function ${name}() { [native code] }`; };
                fn.toString.toString = function () { return 'function toString() { [native code] }'; };
            } catch (e) {}
            return fn;
        }

        try {
            Object.defineProperty(Event.prototype, 'isTrusted', {
                get: function () { return true; },
                configurable: true,
                enumerable: true
            });
        } catch (e) {}

        const wrappedAddEventListener = function (type, fn, opts) {
            if (typeof fn !== 'function') return _origAdd.call(this, type, fn, opts);
            function wrapped(e) {
                try {
                    Object.defineProperty(e, 'isTrusted', {
                        get: () => true,
                        configurable: true
                    });
                } catch (_) {}
                return fn.call(this, e);
            }
            fn._wrapped = wrapped;
            return _origAdd.call(this, type, wrapped, opts);
        };
        makeNativeLike(wrappedAddEventListener, 'addEventListener');
        EventTarget.prototype.addEventListener = wrappedAddEventListener;

        const wrappedRemoveEventListener = function (type, fn, opts) {
            return _origRemove.call(this, type, fn ? (fn._wrapped || fn) : fn, opts);
        };
        makeNativeLike(wrappedRemoveEventListener, 'removeEventListener');
        EventTarget.prototype.removeEventListener = wrappedRemoveEventListener;
    } catch (e) {}
})();
