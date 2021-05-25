import React from 'react';

import Container from 'goblin-gadgets/widgets/container/widget';
import Field from 'goblin-gadgets/widgets/field/widget';
import T from 't';

/******************************************************************************/

function renderPanel(props) {
  return (
    <Container kind="column" grow="1">
      <Container kind="pane">
        <Field labelText={T('Nom')} model=".name" />
      </Container>
      <Container kind="pane" grow="1">
        <Field
          inputType="textarea"
          readonly={true}
          labelWidth="0px"
          grow="1"
          model=".source"
        />
      </Container>
    </Container>
  );
}

function renderCompact(props) {
  return (
    <Container kind="row" grow="1">
      <Field labelText={T('Nom')} model=".name" />
    </Container>
  );
}

function renderExtend(props) {
  return (
    <Container kind="column" grow="1">
      <Field labelText={T('Nom')} model=".name" />
    </Container>
  );
}

/******************************************************************************/
export default {
  panel: {
    readonly: renderPanel,
    edit: renderPanel,
  },
  plugin: {
    readonly: {
      compact: renderCompact,
      extend: renderExtend,
    },
    edit: {
      compact: renderCompact,
      extend: renderExtend,
    },
  },
};
