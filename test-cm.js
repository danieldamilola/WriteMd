const { EditorState } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');
const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM('<!DOCTYPE html><div id="editor"></div>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

// We need to mock some DOM stuff for CodeMirror
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;

try {
  // Let's import the plugins dynamically or just check their logic
  console.log("JSDOM setup complete");
} catch (e) {
  console.error(e);
}
