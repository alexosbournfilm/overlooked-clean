import React, { forwardRef, useEffect, useState } from 'react';
import {
  Alert,
  Text as NativeText,
  TextInput as NativeTextInput,
  TextInputProps,
  TextProps,
} from 'react-native';
import { getAppLanguage } from './languages';
import { translateText } from './translations';
import { getCurrentAppLanguage, useAppLanguage } from '../context/LanguageContext';
import { subscribeDynamicTranslationUpdates } from './dynamicTranslation';

declare const require: any;

let installed = false;
const originalCreateElement = React.createElement;

function translateChildren(children: React.ReactNode, language: ReturnType<typeof getCurrentAppLanguage>) {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') return translateText(child, language);
    return child;
  });
}

function translateTranslatableProps(
  props: Record<string, any> | null | undefined,
  language: ReturnType<typeof getCurrentAppLanguage>
) {
  if (!props || language === 'en') return props;

  const next = { ...props };
  const stringProps = [
    'placeholder',
    'accessibilityLabel',
    'accessibilityHint',
    'title',
    'label',
  ];

  stringProps.forEach((propName) => {
    if (typeof next[propName] === 'string') {
      next[propName] = translateText(next[propName], language);
    }
  });

  return next;
}

const AutoTranslatedText = forwardRef<any, TextProps>((props, ref) => {
  const { language } = useAppLanguage();
  const [, setTranslationVersion] = useState(0);
  const languageMeta = getAppLanguage(language);
  const translatedProps = translateTranslatableProps((props || {}) as any, language) || {};
  const translatedChildren = translateChildren(props.children, language);

  useEffect(() => {
    if (language === 'en') return undefined;
    return subscribeDynamicTranslationUpdates(() => {
      setTranslationVersion((version) => version + 1);
    });
  }, [language]);

  const directionStyle =
    languageMeta.direction === 'rtl'
      ? [{ writingDirection: 'rtl' as const }, translatedProps.style]
      : translatedProps.style;

  const { children: _children, style, ...rest } = translatedProps as any;

  return originalCreateElement(
    NativeText,
    {
      ...rest,
      ref,
      style: languageMeta.direction === 'rtl' ? directionStyle : style,
    },
    translatedChildren
  );
});

AutoTranslatedText.displayName = 'AutoTranslatedText';

const AutoTranslatedTextInput = forwardRef<any, TextInputProps>((props, ref) => {
  const { language } = useAppLanguage();
  const [, setTranslationVersion] = useState(0);
  const languageMeta = getAppLanguage(language);
  const translatedProps = translateTranslatableProps((props || {}) as any, language) || {};

  useEffect(() => {
    if (language === 'en') return undefined;
    return subscribeDynamicTranslationUpdates(() => {
      setTranslationVersion((version) => version + 1);
    });
  }, [language]);

  const directionStyle =
    languageMeta.direction === 'rtl'
      ? [{ writingDirection: 'rtl' as const }, translatedProps.style]
      : translatedProps.style;

  return originalCreateElement(NativeTextInput, {
    ...translatedProps,
    ref,
    style: languageMeta.direction === 'rtl' ? directionStyle : translatedProps.style,
  });
});

AutoTranslatedTextInput.displayName = 'AutoTranslatedTextInput';

function installAlertTranslation() {
  const originalAlert = Alert.alert;
  if ((originalAlert as any).__overlookedTranslated) return;

  const translatedAlert = (
    title: string,
    message?: string,
    buttons?: any[],
    options?: any
  ) => {
    const language = getCurrentAppLanguage();
    const translatedButtons = buttons?.map((button) =>
      typeof button?.text === 'string'
        ? { ...button, text: translateText(button.text, language) }
        : button
    );

    return originalAlert(
      typeof title === 'string' ? translateText(title, language) : title,
      typeof message === 'string' ? translateText(message, language) : message,
      translatedButtons,
      options
    );
  };

  (translatedAlert as any).__overlookedTranslated = true;
  Alert.alert = translatedAlert as typeof Alert.alert;
}

function wrapJsxFactory(originalFactory: any) {
  if (typeof originalFactory !== 'function') return originalFactory;
  if (originalFactory.__overlookedTranslated) return originalFactory;

  const wrappedFactory = (type: any, props: any, ...rest: any[]) => {
    if (getCurrentAppLanguage() === 'en') {
      return originalFactory(type, props, ...rest);
    }

    if (type === NativeText) {
      return originalFactory(AutoTranslatedText, props, ...rest);
    }

    if (type === NativeTextInput) {
      return originalFactory(AutoTranslatedTextInput, props, ...rest);
    }

    return originalFactory(type, props, ...rest);
  };

  wrappedFactory.__overlookedTranslated = true;
  return wrappedFactory;
}

function installJsxRuntimeTranslation() {
  try {
    const jsxRuntime = require('react/jsx-runtime');
    const jsxDevRuntime = require('react/jsx-dev-runtime');

    jsxRuntime.jsx = wrapJsxFactory(jsxRuntime.jsx);
    jsxRuntime.jsxs = wrapJsxFactory(jsxRuntime.jsxs);
    jsxDevRuntime.jsxDEV = wrapJsxFactory(jsxDevRuntime.jsxDEV);
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('Auto translation JSX runtime patch skipped:', error);
    }
  }
}

export function installAutoTranslate() {
  if (installed) return;
  installed = true;

  installAlertTranslation();
  installJsxRuntimeTranslation();

  (React as any).createElement = (type: any, props: any, ...children: any[]) => {
    if (getCurrentAppLanguage() === 'en') {
      return originalCreateElement(type, props, ...children);
    }

    if (type === NativeText) {
      return originalCreateElement(AutoTranslatedText, props, ...children);
    }

    if (type === NativeTextInput) {
      return originalCreateElement(AutoTranslatedTextInput, props, ...children);
    }

    return originalCreateElement(type, props, ...children);
  };
}

installAutoTranslate();
