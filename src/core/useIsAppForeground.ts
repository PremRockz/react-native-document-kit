import {useEffect, useState} from 'react';
import {AppState} from 'react-native';
import type {AppStateStatus} from 'react-native';

/** True while the app is in the foreground. Used to pause the camera session. */
export const useIsAppForeground = (): boolean => {
  const [isForeground, setIsForeground] = useState(
    () => AppState.currentState === 'active',
  );

  useEffect(() => {
    const onChange = (nextState: AppStateStatus) => {
      setIsForeground(nextState === 'active');
    };

    // Re-sync in case the state changed between render and subscribe.
    setIsForeground(AppState.currentState === 'active');

    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);

  return isForeground;
};
