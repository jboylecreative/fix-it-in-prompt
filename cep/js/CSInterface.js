'use strict';

// Minimal CSInterface wrapper for CEP extensions.
// Exposes evalScript() and basic lifecycle methods.

var CSInterface = (function () {

    function CSInterface() {
        try {
            this.hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());
        } catch (e) {
            this.hostEnvironment = {};
        }
    }

    CSInterface.prototype.evalScript = function (script, callback) {
        if (window.__adobe_cep__) {
            window.__adobe_cep__.evalScript(script, callback || function () {});
        } else if (callback) {
            callback('EvalScript Error: CEP runtime not available');
        }
    };

    CSInterface.prototype.addEventListener = function (type, listener, obj) {
        if (window.__adobe_cep__) {
            window.__adobe_cep__.addEventListener(type, listener, obj);
        }
    };

    CSInterface.prototype.removeEventListener = function (type, listener, obj) {
        if (window.__adobe_cep__) {
            window.__adobe_cep__.removeEventListener(type, listener, obj);
        }
    };

    CSInterface.prototype.dispatchEvent = function (event) {
        if (window.__adobe_cep__) {
            window.__adobe_cep__.dispatchEvent(event);
        }
    };

    CSInterface.prototype.openURLInDefaultBrowser = function (url) {
        if (window.__adobe_cep__) {
            window.__adobe_cep__.openURLInDefaultBrowser(url);
        }
    };

    return CSInterface;
}());
