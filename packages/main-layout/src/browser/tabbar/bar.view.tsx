import * as React from 'react';
import * as clsx from 'classnames';
import * as styles from './styles.module.less';
import { Layout } from '@ali/ide-core-browser/lib/components/layout/layout';
import { ComponentRegistryInfo, useInjectable, ConfigProvider, ComponentRenderer, AppConfig } from '@ali/ide-core-browser';
import { TabbarService, TabbarServiceFactory } from './tabbar.service';
import { observer } from 'mobx-react-lite';
import { TabbarConfig } from './renderer.view';
import { getIcon } from '@ali/ide-core-browser';
import { IMainLayoutService } from '../../common';

export const TabbarViewBase: React.FC<{
  TabView: React.FC<{component: ComponentRegistryInfo}>,
  forbidCollapse?: boolean;
  barSize?: number;
  panelBorderSize?: number;
}> = observer(({ TabView, forbidCollapse, barSize = 48, panelBorderSize = 0 }) => {
  const { side, direction } = React.useContext(TabbarConfig);
  const tabbarService: TabbarService = useInjectable(TabbarServiceFactory)(side);
  React.useEffect(() => {
    tabbarService.barSize = barSize;
    tabbarService.panelBorderSize = panelBorderSize;
  }, []);
  const { currentContainerId, handleTabClick } = tabbarService;
  return (
    <div className='tab-bar'>
      <div className={styles.bar_content} style={{flexDirection: Layout.getTabbarDirection(direction)}}>
        {tabbarService.visibleContainers.map((component) => {
          const containerId = component.options!.containerId;
          return (
            <li
              key={containerId}
              id={containerId}
              onContextMenu={(e) => tabbarService.handleContextMenu(e, containerId)}
              onClick={(e) => handleTabClick(e, forbidCollapse)}
              className={clsx({active: currentContainerId === containerId})}>
              <TabView component={component} />
            </li>
          );
        })}
      </div>
    </div>
  );
});

const IconTabView: React.FC<{component: ComponentRegistryInfo}> = observer(({ component }) => {
  return <div className='icon-tab'>
    <div className={clsx(component.options!.iconClass, 'activity-icon')} title={component.options!.title}></div>
    {component.options!.badge && <div className='tab-badge'>{component.options!.badge}</div>}
  </div>;
});

const TextTabView: React.FC<{component: ComponentRegistryInfo}> = observer(({ component }) => {
  return <div className={styles.text_tab}>
    <div className={styles.bottom_tab_title}>{component.options!.title}</div>
    {component.options!.badge && <div className='tab-badge'>{component.options!.badge}</div>}
  </div>;
});

export const RightTabbarRenderer: React.FC = () => <TabbarViewBase TabView={IconTabView} barSize={40} panelBorderSize={2}/>;

export const LeftTabbarRenderer: React.FC = () => {
  const layoutService = useInjectable<IMainLayoutService>(IMainLayoutService);
  return (<div className='left-tab-bar'>
    <TabbarViewBase TabView={IconTabView} barSize={48} panelBorderSize={2}/>
    <div className='bottom-icon-container' onClick={layoutService.handleSetting}>
      <i className={`activity-icon ${getIcon('setting')}`}></i>
    </div>
  </div>);
};

export const BottomTabbarRenderer: React.FC = () => {
  return (
    <div className={styles.bottom_bar_container}>
      <TabbarViewBase forbidCollapse={true} TabView={TextTabView} barSize={0} />
    </div>
  );
};

export const NextBottomTabbarRenderer: React.FC = () => {
  return (
    <div className={clsx(styles.bottom_bar_container, 'next_bottom_bar')}>
      <TabbarViewBase TabView={TextTabView} barSize={28} panelBorderSize={1}/>
    </div>
  );
};
