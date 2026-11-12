import { isMac } from 'insomnia-data/common';
import { type FC, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator, SubmenuTrigger } from 'react-aria-components';

import type { AppMenuItem } from '~/main/title-bar';
import { Icon } from '~/ui/components/icon';

const popoverClass =
  'menubar-popover min-w-[240px] overflow-y-auto rounded-lg border border-solid border-(--hl-sm) bg-(--color-bg) p-[4px] text-[13px] text-(--color-font) shadow-lg select-none focus:outline-none';
const menuItemClass =
  'flex h-[28px] cursor-default items-center gap-[10px] rounded-sm px-[8px] outline-none data-[disabled]:opacity-40 data-[focused]:bg-(--color-surprise) data-[focused]:text-(--color-font-surprise) data-[open]:bg-(--hl-sm)';

const MenuItems: FC<{ items: AppMenuItem[]; onAction: (item: AppMenuItem) => void }> = ({ items, onAction }) => (
  <Menu aria-label="Menu" className="outline-none">
    {items.map(item => {
      if (item.type === 'separator') {
        return <Separator key={item.path.join('.')} className="my-[4px] h-px bg-(--hl-sm)" />;
      }
      const content = (
        <MenuItem
          key={item.path.join('.')}
          textValue={item.label}
          isDisabled={!item.enabled}
          className={menuItemClass}
          onAction={item.submenu ? undefined : () => onAction(item)}
        >
          <span className="flex w-[12px] shrink-0 justify-center">{item.checked && <Icon icon="check" />}</span>
          <span className="flex-1 truncate">{item.label}</span>
          {item.accelerator && <kbd className="ml-[16px] font-sans text-[12px] opacity-60">{item.accelerator}</kbd>}
          {item.submenu && <Icon icon="chevron-right" className="opacity-60" />}
        </MenuItem>
      );
      if (!item.submenu) {
        return content;
      }
      return (
        <SubmenuTrigger key={item.path.join('.')}>
          {content}
          <Popover className={popoverClass} offset={2}>
            <MenuItems items={item.submenu} onAction={onAction} />
          </Popover>
        </SubmenuTrigger>
      );
    })}
  </Menu>
);

const OVERFLOW_LABEL = 'More';
const OVERFLOW_BUTTON_WIDTH = 36;

// macOS keeps the native global menu, so this only renders on Windows and Linux
export const TitleBarMenu: FC = () => {
  const [menus, setMenus] = useState<AppMenuItem[]>([]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(Number.POSITIVE_INFINITY);
  const barRef = useRef<HTMLDivElement>(null);
  const widths = useRef<number[]>([]);

  useEffect(() => {
    if (!isMac) {
      window.main.getAppMenu().then(setMenus);
    }
  }, [openMenu]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || menus.length === 0) {
      return;
    }
    if (widths.current.length !== menus.length) {
      widths.current = [...bar.children].map(child => (child as HTMLElement).offsetWidth);
    }
    const fit = () => {
      const total = widths.current.reduce((sum, width) => sum + width, 0);
      if (total <= bar.clientWidth) {
        setVisibleCount(menus.length);
        return;
      }
      let used = OVERFLOW_BUTTON_WIDTH;
      const count = widths.current.findIndex(width => (used += width) > bar.clientWidth);
      setVisibleCount(Math.max(count, 0));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [menus]);

  // The popovers are non-modal so hovering across the bar can switch menus, which also means
  // they ignore outside clicks. Close them here, and when the window loses focus.
  useEffect(() => {
    if (openMenu === null) {
      return;
    }
    const close = () => setOpenMenu(null);
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[role="menubar"], .menubar-popover')) {
        close();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePress, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress, true);
      window.removeEventListener('blur', close);
    };
  }, [openMenu]);

  // Tapping Alt on its own moves focus into the bar, like a native menu bar. Alt used with another
  // key or a click is left alone.
  const previousFocus = useRef<HTMLElement | null>(null);
  const menusRef = useRef<{ shown: AppMenuItem[]; hidden: AppMenuItem[] }>({ shown: [], hidden: [] });
  useEffect(() => {
    if (isMac) {
      return;
    }
    let altAlone = false;
    const cancel = () => {
      altAlone = false;
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      altAlone = event.key === 'Alt' && !event.repeat && !event.ctrlKey && !event.shiftKey && !event.metaKey;
      // Alt+letter opens the menu marked with that letter, like File in a native menu bar
      if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && event.key.length === 1) {
        const letter = event.key.toLowerCase();
        const { shown, hidden } = menusRef.current;
        const target =
          shown.find(menu => menu.mnemonic === letter) ??
          (hidden.some(menu => menu.mnemonic === letter) ? shown.at(-1) : undefined);
        if (target) {
          event.preventDefault();
          if (!barRef.current?.contains(document.activeElement)) {
            previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }
          setOpenMenu(target.label);
        }
      }
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      const tapped = event.key === 'Alt' && altAlone;
      altAlone = false;
      const bar = barRef.current;
      if (!tapped || !bar) {
        return;
      }
      if (bar.contains(document.activeElement)) {
        setOpenMenu(null);
        previousFocus.current?.focus();
        return;
      }
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpenMenu(null);
      bar.querySelector('button')?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', cancel, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', cancel, true);
    };
  }, []);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    // Popovers render in a portal but still bubble here, so only handle keys pressed on the bar itself
    if (!bar || openMenu !== null || !(event.target instanceof Node) || !bar.contains(event.target)) {
      return;
    }
    if (event.key === 'Escape') {
      previousFocus.current?.focus();
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const buttons = [...bar.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) {
      return;
    }
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    buttons[(index + offset + buttons.length) % buttons.length].focus();
  };

  const hiddenMenus = menus.slice(visibleCount);
  const shownMenus: AppMenuItem[] = hiddenMenus.length
    ? [
        ...menus.slice(0, visibleCount),
        { type: 'normal', label: OVERFLOW_LABEL, enabled: true, checked: false, path: [], submenu: hiddenMenus },
      ]
    : menus;
  menusRef.current = { shown: shownMenus, hidden: hiddenMenus };

  const moveMenu = (event: KeyboardEvent, label: string) => {
    if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.defaultPrevented) {
      return;
    }
    if ((event.target as HTMLElement).getAttribute('aria-haspopup') && event.key === 'ArrowRight') {
      return;
    }
    const index = shownMenus.findIndex(menu => menu.label === label);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    setOpenMenu(shownMenus[(index + offset + shownMenus.length) % shownMenus.length].label);
  };

  return (
    <div
      ref={barRef}
      role="menubar"
      aria-label="Application menu"
      className="flex h-full min-w-0 flex-1 items-center"
      onKeyDown={moveFocus}
    >
      {shownMenus.map(menu => (
        <MenuTrigger
          key={menu.label}
          isOpen={openMenu === menu.label}
          onOpenChange={isOpen => setOpenMenu(isOpen ? menu.label : null)}
        >
          <Button
            aria-label={menu.label === OVERFLOW_LABEL ? 'More menus' : undefined}
            className="h-[26px] shrink-0 rounded-sm px-[8px] text-[13px] text-(--color-font) opacity-80 transition-colors outline-none hover:bg-(--hl-sm) hover:opacity-100 focus-visible:ring-1 focus-visible:ring-(--color-surprise) aria-expanded:bg-(--hl-sm) aria-expanded:opacity-100"
            onHoverStart={() => openMenu && setOpenMenu(menu.label)}
          >
            {menu.label === OVERFLOW_LABEL ? <Icon icon="ellipsis" /> : menu.label}
          </Button>
          <Popover isNonModal placement="bottom start" offset={2} className={popoverClass}>
            <div onKeyDown={event => moveMenu(event, menu.label)}>
              <MenuItems items={menu.submenu ?? []} onAction={item => window.main.clickAppMenuItem(item.path)} />
            </div>
          </Popover>
        </MenuTrigger>
      ))}
    </div>
  );
};
