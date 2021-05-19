//T:2019-02-27

import React from 'react';
import Widget from 'goblin-laboratory/widgets/widget';
import View from 'goblin-laboratory/widgets/view';
import Container from 'goblin-gadgets/widgets/container/widget.js';
import Button from 'goblin-gadgets/widgets/button/widget.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import prettier from 'prettier';

class ResultViewNC extends Widget {
  constructor() {
    super(...arguments);
  }

  render() {
    return (
      <Container
        height="100%"
        width="100%"
        grow="1"
        backgroundColor="lightgrey"
      >
        {this.props.res}
      </Container>
    );
  }
}

const ResultView = Widget.connect((state, prop) => {
  const res = state.get(`backend.${prop.id}.res`);
  return {res};
})(ResultViewNC);
class RethinkQueryEditor extends Widget {
  constructor() {
    super(...arguments);
    this.assign = this.assign.bind(this);
    this.init = this.init.bind(this);
    this.update = this.update.bind(this);
    this.run = this.run.bind(this);
    this.format = this.format.bind(this);
    this.editorElement = undefined;
  }

  run() {
    this.do('run');
  }

  update(value) {
    this.do('update', {src: value});
  }

  format() {
    let src = this.model.getValue();
    try {
      src = prettier.format(src, {parser: 'babel'});
      this.model.setValue(src);
    } catch (err) {
      console.error(err.stack);
    }
  }

  assign(component) {
    this.editorElement = component;
  }

  componentDidMount() {
    this.init();
  }

  componentWillUnmount() {
    this.destroy();
  }

  destroy() {
    if (this.editor) {
      this.editor.dispose();
      const model = this.editor.getModel();
      if (model) {
        model.dispose();
      }
    }
    this._subscription && this._subscription.dispose();
  }

  init() {
    const templateSrc = `
    //////////////////////////////////////
    // Extraction Step
    //
    // available in scope:
    // con	 rethinkdb connection object
    // r	   rethinkdb r query object
    // dir	 function like console.dir
    // next	 callback for async calls
    //
    //////////////////////////////////////
    function* extract(){
      const q = r.db('polypheme').table('customer');
      return yield q.run(con, next);
    }
    
    //////////////////////////////////////
    // Transform Step
    //
    // Here you can transform
    // print	 print in IDE
    //////////////////////////////////////
    function* transform(row) {
      row.ok = true;
      print(row);
      return row;
    }


    //////////////////////////////////////
    // Load Step (output)
    //
    // Csv	 create Csv output
    //////////////////////////////////////
    const output1 = new Csv('ok.csv');
    const output2 = new Csv('ko.csv');
    function* load(row) {
      if(row.ok){
        output1.insert(row);
      }else{
        output2.insert(row);
      }
    }
    `;

    const model = monaco.editor.createModel(templateSrc, 'javascript');
    this.model = model;
    this.format();
    this._subscription = model.onDidChangeContent(() => {
      const src = model.getValue();
      this.props.onValueChange(src);
      this.update(src);
    });

    /*function createSuggestions(range) {
      // returning a static list of proposals, not even looking at the prefix (filtering is done by the Monaco editor),
      // here you could do a server side lookup
      return [
        {
          label: '"do"',
          kind: monaco.languages.CompletionItemKind.Function,
          documentation: 'Call the reducer',
          insertText: '"quest.do()',
          range: range,
        },
      ];
    }

    monaco.languages.registerCompletionItemProvider('javascript', {
      provideCompletionItems: function (model, position) {
        var textUntilPosition = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        console.log(textUntilPosition);
        var match = textUntilPosition.match(/.quest\.$/g);
        if (!match) {
          return {suggestions: []};
        }
        console.log('match');
        var word = model.getWordUntilPosition(position);
        var range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: [createSuggestions(range)],
        };
      },
    });*/

    this.editor = monaco.editor.create(this.editorElement, {
      language: 'javascript',
      lineNumbers: 'on',
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
      },
      theme: 'vs',
      automaticLayout: true,
    });

    this.editor.setModel(model);
    this.update(templateSrc);
    monaco.editor.setTheme('vs');
  }

  render() {
    return (
      <Container kind="pane" height="100%">
        <Container kind="row" grow="1">
          <Button
            text="FORMAT (ctrl+f)"
            glyph="solid/edit"
            width="160px"
            active={false}
            kind="subaction"
            onClick={this.format}
          />
          <Button
            text="RUN (ctrl+r)"
            glyph="solid/rocket"
            width="160px"
            active={false}
            kind="subaction"
            onClick={this.run}
          />
        </Container>
        <Container kind="row" height="100%" grow="1">
          <Container kind="column" width="100%" height="100%" grow="1">
            <div
              id="editor"
              style={{width: '100%', height: '100%'}}
              ref={this.assign}
            />
          </Container>
          <Container kind="column" height="100%" width="100%">
            <ResultView id={this.props.id} />
          </Container>
        </Container>
      </Container>
    );
  }
}

class PlaygroundEditorView extends View {
  constructor() {
    super(...arguments);
  }

  render() {
    const {workitemId, desktopId} = this.props;
    return (
      <Container kind="row" grow="1" width="100%">
        <Container kind="column" height="100%" grow="1">
          <RethinkQueryEditor
            id={workitemId}
            desktopId={desktopId}
            onValueChange={() => null}
          />
        </Container>
      </Container>
    );
  }
}

export default PlaygroundEditorView;
