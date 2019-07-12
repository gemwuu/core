import * as React from 'react';
import { useInjectable } from '@ali/ide-core-browser/lib/react-hooks';
import { observer } from 'mobx-react-lite';
import { CollapsePanelContainer, CollapsePanel, IExplorerAction } from '@ali/ide-core-browser/lib/components';
import * as styles from './explorer.module.less';
import { FileTree } from '@ali/ide-file-tree/lib/browser/file-tree.view';
import { OpenedEditorTree } from '@ali/ide-opened-editor/lib/browser/opened-editor.view';
import { ExplorerResourceService } from './explorer-resource.service';
import { ExplorerService } from './explorer.service';
import { localize } from '@ali/ide-core-browser';
import { ExplorerOpenedEditorService } from './explorer-opened-editor.service';
export const Explorer = observer(() => {
  const explorerResourceService = useInjectable(ExplorerResourceService);
  const explorerOpenedEditorService = useInjectable(ExplorerOpenedEditorService);
  const explorerService = useInjectable(ExplorerService);

  const activeKey = explorerService.activeKey;
  const treeData = explorerOpenedEditorService.treeData;
  const keymap = explorerService.keymap;

  const actions: IExplorerAction[] = [
    {
      iconClass: 'new_file',
      action: explorerService.newFile,
      title: localize('explorer.action.new.file'),
    },
    {
      iconClass: 'new_folder',
      action: explorerService.newFolder,
      title: localize('explorer.action.new.folder'),
    },
    {
      iconClass: 'refresh_explorer',
      action: explorerService.refresh,
      title: localize('explorer.action.refresh'),
    },
    {
      iconClass: 'collapse_explorer',
      action: explorerService.collapseAll,
      title: localize('explorer.action.collapse'),
    },
  ];

  const layout = explorerService.layout;

  const collapsePanelContainerStyle = {
    width: layout.width,
    height: layout.height,
  };

  const panelContainerChangeHandler = (change: string[]) => {
    explorerService.updateActiveKey(change);
  };

  return <CollapsePanelContainer className={ styles.kt_explorer } activeKey={ activeKey } style={collapsePanelContainerStyle} onChange={ panelContainerChangeHandler }>
    <CollapsePanel header='OPEN EDITORS' key={keymap.openeditor} priority={1}>
      <OpenedEditorTree nodes= { treeData } ></OpenedEditorTree>
    </CollapsePanel>
    <CollapsePanel
      header = { explorerResourceService.root.displayName }
      key = {keymap.resource}
      priority = {2}
      actions = { actions }
    >
      <FileTree
        files={ explorerResourceService.files }
        onSelect={ explorerResourceService.onSelect }
        onDragStart={ explorerResourceService.onDragStart }
        onDragOver={ explorerResourceService.onDragOver }
        onDragEnter={ explorerResourceService.onDragEnter }
        onDragLeave={ explorerResourceService.onDragLeave }
        onChange = { explorerResourceService.onChange }
        onDrop={ explorerResourceService.onDrop }
        draggable={ explorerResourceService.draggable }
        editable={ explorerResourceService.editable }
        multiSelectable={ explorerResourceService.multiSelectable }
        onContextMenu={ explorerResourceService.onContextMenu }
        position = { explorerResourceService.position }
        key={ explorerResourceService.key }
      ></FileTree>
    </CollapsePanel>
    <CollapsePanel header='OUTLINE' key={keymap.outline} priority={1}></CollapsePanel>
  </CollapsePanelContainer>;
});
