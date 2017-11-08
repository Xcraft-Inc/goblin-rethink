class MarkdownBuilder {
  constructor (text, level) {
    this._level = level || 0;
    this._formatted = '';
    if (text && text.match (/[a-zA-Z0-9]/)) {
      this._formatted += `${text}\n`;
    }
  }

  get _isSuperMarkdownBuilder () {
    return true;
  }

  levelUp () {
    this._level++;
    return this;
  }

  _ensureType (text) {
    if (typeof text === 'string') {
      if (text.startsWith ('```') && text.endsWith ('```')) {
        text = text.substring (3, text.length - 3);
      }
      return new MarkdownBuilder (text, this._level + 1);
    }
    if (text && text._isSuperMarkdownBuilder) {
      return text.levelUp ();
    }

    throw new Error ('bad type');
  }

  get _isEmpty () {
    return !this._formatted.match (/[a-zA-Z0-9]/);
  }

  title (title) {
    title = this._ensureType (title);
    if (!title._isEmpty) {
      this._formatted += `# ${title.end ()}\n`;
    }
    return this;
  }

  line (line) {
    line = this._ensureType (line);
    if (!line._isEmpty) {
      this._formatted += `${line.end ()}\n`;
    }
    return this;
  }

  list (list) {
    list.forEach (text => {
      text = this._ensureType (text);
      if (!text._isEmpty) {
        this._formatted += `* ${text.end ()}\n`;
      }
    });
    return this;
  }

  end () {
    if (this._level === 0) {
      return '```' + this._formatted + '```';
    } else {
      let result = '';
      for (let i = 0; i < this._level; i++) {
        result += '  ';
      }
      return result + this._formatted;
    }
  }
}

module.exports = MarkdownBuilder;
