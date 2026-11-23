import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {DocumentKitProvider} from 'react-native-document-kit';
import {Playground} from './src/Playground';

/** Mount the provider once near the root. */
const App = () => (
  <SafeAreaProvider>
    <StatusBar barStyle="dark-content" />
    <DocumentKitProvider
      onError={(error, {operation}) => console.warn(`[DocumentKit] ${operation}`, error)}
      onUnauthorized={async () => null}>
      <Playground />
    </DocumentKitProvider>
  </SafeAreaProvider>
);

export default App;
