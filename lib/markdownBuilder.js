// https://www.npmjs.com/package/react-markdown
// http://rexxars.github.io/react-markdown/

class MarkdownBuilder {
  constructor () {
    this._formatted = '';
    this._level = -1;
  }

  joinWords (array) {
    return MarkdownBuilder._join (array, ' ');
  }

  joinPhrases (array) {
    return MarkdownBuilder._join (array, ', ');
  }

  joinLines (array) {
    return MarkdownBuilder._join (array, '\\\n');
  }

  join (array, separator) {
    return MarkdownBuilder._join (array, separator);
  }

  bold (text) {
    return `__${text}__`;
  }

  italic (text) {
    return `_${text}_`;
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

  addBlock (text) {
    if (MarkdownBuilder._isEmpty (text)) {
      return;
    }
    if (MarkdownBuilder._isMarkdown (text)) {
      text = MarkdownBuilder._extract (text);
    }
    for (let i = 0; i < this._level; i++) {
      this._formatted += '  ';
    }
    this._formatted += `${text}\n\n`;
  }

  addBlocks (list) {
    this.startList ();
    list.forEach (text => {
      this.addBlock (text);
    });
    this.endList ();
  }

  addBullet (text) {
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

  addBullets (list) {
    this.startList ();
    list.forEach (text => {
      this.addBullet (text);
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

  static _join (array, separator) {
    return array
      .filter (function (val) {
        return val;
      })
      .join (separator);
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
