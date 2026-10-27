import React, {useMemo, useState} from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {DocumentKitProvider} from 'react-native-document-kit';
import {ACCENTS, Playground} from './src/Playground';
import type {AccentName} from './src/Playground';

/** Mount the provider once near the root; the playground switches its theme live. */
const App = () => {
  const [accent, setAccent] = useState<AccentName>('Blue');
  const theme = useMemo(() => ({primaryColor: ACCENTS[accent]}), [accent]);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <DocumentKitProvider
        theme={theme}
        onError={(error, {operation}) => console.warn(`[DocumentKit] ${operation}`, error)}
        onUnauthorized={async () => null}>
        <Playground accent={accent} onAccentChange={setAccent} />
      </DocumentKitProvider>
    </SafeAreaProvider>
  );
};

export default App;
