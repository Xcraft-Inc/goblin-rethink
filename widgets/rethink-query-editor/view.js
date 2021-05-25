//T:2019-02-27

import React from 'react';
import Widget from 'goblin-laboratory/widgets/widget';
import View from 'goblin-laboratory/widgets/view';
import Container from 'goblin-gadgets/widgets/container/widget.js';
import Button from 'goblin-gadgets/widgets/button/widget.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import prettier from 'prettier';

class ConsoleLineNC extends Widget {
  constructor() {
    super(...arguments);
  }

  render() {
    const {index, line} = this.props;
    return (
      <React.Fragment>
        {index} {line}
        <br />
      </React.Fragment>
    );
  }
}

const ConsoleLine = Widget.connect((state, prop) => {
  const line = state.get(`backend.${prop.id}.lines[${prop.index}]`);
  return {line};
})(ConsoleLineNC);

class ConsoleNC extends Widget {
  constructor() {
    super(...arguments);
  }

  render() {
    const {id, lines, printStatus} = this.props;
    const console = {
      font: '16px/1 monospace',
      whiteSpace: 'break-spaces',
      overflow: 'auto',
      height: '100%',
      width: '100%',
      userSelect: 'text',
    };
    return (
      <div style={console}>
        {lines.map((l, k) => (
          <ConsoleLine id={id} key={k} index={l} />
        ))}
        <small style={{userSelect: 'text'}}>{printStatus}</small>
      </div>
    );
  }
}

const Console = Widget.connect((state, prop) => {
  const lines = state.get(`backend.${prop.id}.lines`);
  const printStatus = state.get(`backend.${prop.id}.printStatus`);
  if (!lines) {
    return {lines: [], printStatus: ''};
  }
  return {lines: Array.from(lines.keySeq()), printStatus};
})(ConsoleNC);
class RethinkQueryEditor extends Widget {
  constructor() {
    super(...arguments);
    this.assign = this.assign.bind(this);
    this.init = this.init.bind(this);
    this.update = this.update.bind(this);
    this.run = this.run.bind(this);
    this.format = this.format.bind(this);
    this.save = this.save.bind(this);
    this.editorElement = undefined;
  }

  run() {
    this.do('run');
  }

  save() {
    this.format();
    this.do('save');
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
      this.editor.deltaDecorations(
        [],
        [
          {
            range: new monaco.Range(3, 1, 3, 1),
            options: {
              isWholeLine: true,
              className: 'prettierError',
              glyphMarginClassName: 'prettierError',
            },
          },
        ]
      );
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
    const templateSrc = this.props.source;

    const model = monaco.editor.createModel(templateSrc, 'javascript');
    this.model = model;
    this.format();
    this._subscription = model.onDidChangeContent(() => {
      const src = model.getValue();
      this.props.onValueChange(src);
      this.update(src);
    });

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
    const {name} = this.props;
    return (
      <Container kind="pane" height="100%">
        <h1>{name}</h1>
        <Container kind="row" grow="1">
          <Button
            text="LOAD"
            glyph="solid/save"
            width="160px"
            active={false}
            kind="subaction"
            onClick={this.format}
          />
          <Button
            text="SAVE (ctrl+s)"
            glyph="solid/save"
            width="160px"
            active={false}
            kind="subaction"
            onClick={this.save}
          />
          <Button
            text="SAVE AS"
            glyph="solid/save"
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
          <Container kind="column" height="80%" width="100%">
            <Console id={this.props.id} />
          </Container>
        </Container>
      </Container>
    );
  }
}

const EditorLoaderNC = (props) => {
  if (!props.loaded) {
    return null;
  }
  return (
    <RethinkQueryEditor
      id={props.id}
      desktopId={props.desktopId}
      onValueChange={() => null}
      jobId={props.jobId}
      name={props.name}
      source={props.source}
    />
  );
};

const EditorLoader = Widget.connect((state, prop) => {
  const ide = state.get(`backend.${prop.id}`);

  if (!ide) {
    return {loaded: false};
  } else {
    const {name, source, jobId} = ide.pick('name', 'source', 'jobId');
    return {loaded: true, name, source, jobId};
  }
})(EditorLoaderNC);

class PlaygroundEditorView extends View {
  constructor() {
    super(...arguments);
  }

  render() {
    const {workitemId, desktopId} = this.props;
    return (
      <Container kind="row" grow="1" width="100%">
        <Container kind="column" height="100%" grow="1">
          <EditorLoader id={workitemId} desktopId={desktopId} />
        </Container>
      </Container>
    );
  }
}

export default PlaygroundEditorView;
