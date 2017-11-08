class MarkdownBuilder {
  constructor () {
    this._formatted = '';
    this._level = -1;
  }

  joinWords (array) {
    return array.join (' ');
  }

  joinPhrases (array) {
    return array.join (', ');
  }

  joinLines (array) {
    return array.join ('\\\n');
  }

  addTitle (title) {
    if (MarkdownBuilder._isEmpty (title)) {
      return;
    }
    if (MarkdownBuilder._isMarkdown (title)) {
      throw new Error (`Markdown not accepted in title: ${title}`);
    }
    this._formatted += `# ${title}\n`;
  }

  addBloc (text) {
    if (MarkdownBuilder._isEmpty (text)) {
      return;
    }
    if (MarkdownBuilder._isMarkdown (text)) {
      text = MarkdownBuilder._extract (text);
    }
    for (let i = 0; i < this._level; i++) {
      this._formatted += '  ';
    }
    this._formatted += `${text}\n`;
  }

  addLine (text) {
    if (this._level < 0) {
      throw new Error (`Invalid level: ${this._level}`);
    }
    if (MarkdownBuilder._isEmpty (text)) {
      return;
    }
    if (MarkdownBuilder._isMarkdown (text)) {
      text = MarkdownBuilder._extract (text);
    }
    for (let i = 0; i < this._level; i++) {
      this._formatted += '  ';
    }
    this._formatted += `* ${text}\n`;
  }

  addList (list) {
    this.startList ();
    list.forEach (text => {
      this.addLine (text);
    });
    this.endList ();
  }

  startList () {
    this._level++;
  }

  endList () {
    this._level--;
  }

  toString () {
    //- console.log ('toString = ' + this._formatted);
    return '```' + this._formatted + '```';
  }

  static _isEmpty (text) {
    return !text || !text.match (/[a-zA-Z0-9]/);
  }

  static _isMarkdown (text) {
    return text && text.startsWith ('```') && text.endsWith ('```');
  }

  static _extract (text) {
    return text.substring (3, text.length - 3);
  }
}

module.exports = MarkdownBuilder;
