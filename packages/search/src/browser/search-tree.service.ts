import * as React from 'react';
import { action } from 'mobx';
import { URI, Schemas, Emitter, formatLocalize, dispose, IDisposable, DisposableStore, IRange, localize, MessageType } from '@ali/ide-core-common';
import { Injectable, Autowired } from '@ali/common-di';
import { IEditorDocumentModelService, IEditorDocumentModelContentRegistry, IEditorDocumentModelContentProvider } from '@ali/ide-editor/lib/browser';
import { IWorkspaceService } from '@ali/ide-workspace';
import { WorkbenchEditorService, TrackedRangeStickiness } from '@ali/ide-editor';
import { IWorkspaceEditService } from '@ali/ide-workspace-edit';
import { IDialogService } from '@ali/ide-overlay';
import { AbstractContextMenuService, ICtxMenuRenderer, MenuId } from '@ali/ide-core-browser/lib/menu/next';

import { replaceAll, replace } from './replace';
import { ContentSearchClientService } from './search.service';
import {
  ContentSearchResult,
  ISearchTreeItem,
} from '../common';
import { SearchPreferences } from './search-preferences';

const REPLACE_PREVIEW = 'replacePreview';

const toReplaceResource = (fileResource: URI): URI => {
  return fileResource.withScheme(Schemas.internal).withFragment(REPLACE_PREVIEW).withQuery(JSON.stringify({ scheme: fileResource.scheme }));
};

@Injectable()
export class RangeHighlightDecorations implements IDisposable {

  private _decorationId: string | null = null;
  private _model: monaco.editor.ITextModel | null = null;
  private readonly _modelDisposables = new DisposableStore();

  @Autowired(IEditorDocumentModelService)
  documentModelManager: IEditorDocumentModelService;

  removeHighlightRange() {
    if (this._model && this._decorationId) {
      this._model.deltaDecorations([this._decorationId], []);
    }
    this._decorationId = null;
  }

  highlightRange(resource: URI | monaco.editor.ITextModel, range: IRange, ownerId: number = 0): void {
    let model: monaco.editor.ITextModel | null = null;
    if (URI.isUri(resource)) {
      const modelRef = this.documentModelManager.getModelReference(resource);
      if (modelRef) {
        model = modelRef.instance.getMonacoModel();
      }
    } else {
      model = resource;
    }

    if (model) {
      this.doHighlightRange(model, range);
    }
  }

  private doHighlightRange(model: monaco.editor.ITextModel, range: IRange) {
    this.removeHighlightRange();
    this._decorationId = model.deltaDecorations([], [{ range, options: RangeHighlightDecorations._RANGE_HIGHLIGHT_DECORATION }])[0];
    this.setModel(model);
  }

  private setModel(model: monaco.editor.ITextModel) {
    if (this._model !== model) {
      this.clearModelListeners();
      this._model = model;
      this._modelDisposables.add(this._model.onDidChangeDecorations((e) => {
        this.clearModelListeners();
        this.removeHighlightRange();
        this._model = null;
      }));
      this._modelDisposables.add(this._model.onWillDispose(() => {
        this.clearModelListeners();
        this.removeHighlightRange();
        this._model = null;
      }));
    }
  }

  private clearModelListeners() {
    this._modelDisposables.clear();
  }

  dispose() {
    if (this._model) {
      this.removeHighlightRange();
      this._modelDisposables.dispose();
      this._model = null;
    }
  }

  private static readonly _RANGE_HIGHLIGHT_DECORATION = {
    stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    className: 'rangeHighlight',
    isWholeLine: true,
  } as any;
}

@Injectable()
export class ReplaceDocumentModelContentProvider implements IEditorDocumentModelContentProvider {

  contentMap: Map<string, string> = new Map();

  @Autowired(IEditorDocumentModelService)
  private documentModelManager: IEditorDocumentModelService;

  @Autowired(ContentSearchClientService)
  private searchBrowserService: ContentSearchClientService;

  @Autowired(IWorkspaceEditService)
  private workspaceEditService: IWorkspaceEditService;

  private onDidChangeContentEvent: Emitter<URI> = new Emitter();

  handlesScheme(scheme: string) {
    return scheme === Schemas.internal;
  }

  provideEditorDocumentModelContent(uri: URI, encoding?: string): string {
    return this.contentMap.get(uri.toString()) || '';
  }

  isReadonly() {
    return true;
  }

  async updateContent(uri: URI, encoding?: string): Promise<any> {
    const sourceFileUri = uri.withScheme(JSON.parse(uri.query).scheme).withoutQuery().withoutFragment();
    const sourceDocModelRef = this.documentModelManager.getModelReference(sourceFileUri) || await this.documentModelManager.createModelReference(sourceFileUri);
    const sourceDocModel = sourceDocModelRef.instance;
    const value = sourceDocModel.getText();
    const replaceViewDocModelRef = this.documentModelManager.getModelReference(uri) || await this.documentModelManager.createModelReference(uri);
    const replaceViewDocModel = replaceViewDocModelRef.instance;

    replaceViewDocModel.updateContent(value);

    let searchResults = this.searchBrowserService.searchResults.get(sourceFileUri.toString());

    if (!searchResults) {
      return '';
    }

    searchResults = searchResults.map((result) => {
      return Object.assign({}, result, {
        fileUri: uri.toString(),
      });
    });

    await replace(
      this.workspaceEditService,
      searchResults,
      this.searchBrowserService.replaceValue,
    );

    this.contentMap.set(uri.toString(), replaceViewDocModel.getText());
  }

  onDidChangeContent = this.onDidChangeContentEvent.event;

  delete(uri: URI) {
    this.contentMap.delete(uri.toString());
  }

  clear() {
    this.contentMap.clear();
  }
}

@Injectable()
export class SearchTreeService {
  _setNodes: any = () => {};
  _nodes: ISearchTreeItem[] = [];
  isContextmenuOnFile: boolean = false;

  private lastSelectTime: number = Number(new Date());

  private readonly disposables: IDisposable[] = [];

  @Autowired(IEditorDocumentModelService)
  documentModelManager: IEditorDocumentModelService;

  @Autowired(ContentSearchClientService)
  searchBrowserService: ContentSearchClientService;

  @Autowired(IWorkspaceService)
  workspaceService: IWorkspaceService;

  @Autowired(WorkbenchEditorService)
  workbenchEditorService: WorkbenchEditorService;

  @Autowired(IWorkspaceEditService)
  private workspaceEditService: IWorkspaceEditService;

  @Autowired(IEditorDocumentModelContentRegistry)
  private contentRegistry: IEditorDocumentModelContentRegistry;

  @Autowired(ReplaceDocumentModelContentProvider)
  private replaceDocumentModelContentProvider: ReplaceDocumentModelContentProvider;

  @Autowired(SearchPreferences)
  private searchPreferences: SearchPreferences;

  @Autowired(RangeHighlightDecorations)
  private rangeHighlightDecorations: RangeHighlightDecorations;

  @Autowired(IDialogService)
  private dialogService: IDialogService;

  @Autowired(AbstractContextMenuService)
  private readonly ctxmenuService: AbstractContextMenuService;

  @Autowired(ICtxMenuRenderer)
  private readonly ctxMenuRenderer: ICtxMenuRenderer;

  constructor() {
    this.contentRegistry.registerEditorDocumentModelContentProvider(
      this.replaceDocumentModelContentProvider,
    );
  }

  set nodes(data: ISearchTreeItem[]) {
    // 同步展开状态
    data.forEach((newNode) => {
      this._nodes.some((oldNode) => {
        if (oldNode.id === newNode.id) {
          newNode.expanded = oldNode.expanded;
          return true;
        }
      });
    });
    this._setNodes(data);
    this._nodes = data;
  }

  get nodes() {
    return this._nodes;
  }

  @action.bound
  updateNodes() {
    this.getParentNodes().then((data) => {
      this.nodes = data;
    });
  }

  @action.bound
  onContextMenu(files: ISearchTreeItem[], event: React.MouseEvent<HTMLElement>) {
    const { x, y } = event.nativeEvent;
    const file: ISearchTreeItem = files[0];
    if (!file) {
      return;
    }
    const data: any = { id : file.id};
    data.file = file;

    if (!file.parent) {
      data.path = file.uri!.withoutScheme().toString();
    }

    if (file.parent) {
      this.isContextmenuOnFile = false;
    } else {
      this.isContextmenuOnFile = true;
    }

    const menus = this.ctxmenuService.createMenu({
      id: MenuId.SearchContext,
      config: {
        args: [ data ],
      },
    });

    const menuNodes = menus.getMergedMenuNodes();
    menus.dispose();

    this.ctxMenuRenderer.show({
      anchor: { x, y },
      menuNodes,
    });
  }

  @action.bound
  async onSelect(
    files: ISearchTreeItem[],
  ) {
    const file: ISearchTreeItem = files[0];

    if (!file) {
      return;
    }

    if (!file.parent) {
      // Click file name
      const newNodes = this._nodes.map((node) => {
        if (node.id === file!.id) {
          node.expanded = !node.expanded;
        }
        return node;
      });
      this.nodes = newNodes;
      return;
    }

    // Click file result line
    const result: ContentSearchResult = file.searchResult!;
    const replaceValue = this.searchBrowserService.replaceValue;
    const isOpenReplaceView = this.searchPreferences['search.useReplacePreview'];
    const now = Number(new Date());
    const isPreview = (now - this.lastSelectTime) / 100 > 2; // 200 毫秒 认为双击

    this.lastSelectTime = now;

    if (isOpenReplaceView && replaceValue.length > 0) {
      // Open diff editor
      const originalURI = new URI(result.fileUri);
      const replaceURI = toReplaceResource(originalURI);

      await this.replaceDocumentModelContentProvider.updateContent(replaceURI);

      const openResourceResult = await this.workbenchEditorService.open(
        URI.from({
          scheme: 'diff',
          query: URI.stringifyQuery({
            name: formatLocalize('search.fileReplaceChanges', originalURI.displayName, replaceURI.displayName),
            original: originalURI,
            modified: replaceURI,
          }),
        }),
        {
          preview: isPreview,
        },
      );
      if (openResourceResult) {
        const group = openResourceResult.group;
        const editor = group.currentEditor;
        if (editor) {
          const monaco = editor.monacoEditor;
          monaco.revealLineInCenter(result.line);
        }
      }
      this.replaceDocumentModelContentProvider.delete(replaceURI);
    } else {
      const uri = new URI(result.fileUri);
      await this.workbenchEditorService.open(
        new URI(result.fileUri),
        {
          preview: isPreview,
          range: {
            startLineNumber: result.line,
            startColumn: result.matchStart,
            endLineNumber: result.line,
            endColumn: result.matchStart + result.matchLength,
          },
        },
      );

      this.rangeHighlightDecorations.highlightRange(uri, new monaco.Range(result.line, result.matchStart, result.line, result.matchStart + result.matchLength));
    }

  }

  @action.bound
  foldTree() {
    const newNodes = this._nodes.map((node) => {
      node.expanded = false;
      return node;
    });
    this.nodes = newNodes;
  }

  @action.bound
  commandActuator(
    commandId: string,
    id: string,
  ) {
    const workspaceEditService = this.workspaceEditService;
    const { resultTotal, searchResults, replaceValue } = this.searchBrowserService;
    const items = this._nodes;

    const methods = {
      closeResult() {
        const parentId = id.replace(/\?index=\d$/, '');
        const matchIndex = id.match(/\d$/);
        if (!matchIndex || !parentId) {
          return;
        }
        const index = matchIndex[0];
        const oldData = searchResults.get(parentId);
        if (!oldData) {
          return;
        }
        if (oldData.length === 1) {
          return methods.closeResults(parentId);
        }
        oldData.splice(Number(index), 1);
        resultTotal.resultNum = resultTotal.resultNum - 1;
      },
      replaceResult() {
        let select: ISearchTreeItem | null = null;
        items.some((item) => {
          if (id === item.id) {
            select = item;
            return true;
          }
        });
        if (!select) {
          return;
        }
        const resultMap: Map<string, ContentSearchResult[]> = new Map();
        resultMap.set(select!.parent!.uri!.toString(), [select!.searchResult!]);
        replaceAll(
          workspaceEditService,
          resultMap,
          replaceValue,
        ).then(() => {
          // 结果树更新由 search.service.watchDocModelContentChange 负责
        });
      },
      closeResults(insertId?: string) {
        const parentId = insertId || id.replace(/\?index=\d$/, '');
        if (!parentId) {
          return;
        }
        const oldData = searchResults.get(parentId);
        resultTotal.fileNum = resultTotal.fileNum - 1;
        resultTotal.resultNum = resultTotal.resultNum - oldData!.length;
        searchResults.delete(parentId);
      },
      replaceResults: async () => {
        let select: ISearchTreeItem | null = null;
        items.some((item) => {
          if (id === item.id) {
            select = item;
            return true;
          }
        });
        if (!select) {
          return;
        }
        const resultMap: Map<string, ContentSearchResult[]> = new Map();
        const contentSearchResult: ContentSearchResult[] = select!.children!.map((child) => {
          return child.searchResult!;
        });
        const buttons = {
          [localize('ButtonCancel')]: false,
          [localize('search.replace.buttonOK')]: true,
        };
        const selection = await this.dialogService.open(
          formatLocalize('search.removeAll.occurrences.file.confirmation.message', String(contentSearchResult.length)),
          MessageType.Warning,
          Object.keys(buttons),
        );
        if (!buttons[selection!]) {
          return buttons[selection!];
        }
        resultMap.set(select!.fileUri, contentSearchResult);
        replaceAll(
          workspaceEditService,
          resultMap,
          replaceValue,
        ).then(() => {
           // 结果树更新由 search.service.watchDocModelContentChange 负责
        });
      },
    };

    if (!methods[commandId]) {
      return;
    }
    return methods[commandId]();
  }

  removeHighlightRange() {
    this.rangeHighlightDecorations.removeHighlightRange();
  }

  dispose() {
    dispose(this.disposables);
    this.rangeHighlightDecorations.dispose();
  }

  private getChildrenNodes(resultList: ContentSearchResult[], uri: URI, parent?): ISearchTreeItem[] {
    const result: ISearchTreeItem[] = [];
    resultList.forEach((insertSearchResult: ContentSearchResult, index: number) => {
      const searchResult = insertSearchResult;
      const start = (searchResult.renderStart || searchResult.matchStart) - 1;

      result.push({
        id: `${uri.toString()}?index=${index}`,
        name: '',
        description: searchResult.renderLineText || searchResult.lineText,
        highLightRanges: {
          description: [{
            start,
            end: start + searchResult.matchLength,
          }],
        },
        order: index,
        depth: 1,
        searchResult: insertSearchResult,
        parent,
        uri,
      });
    });

    return result;
  }

  private async getParentNodes(): Promise< ISearchTreeItem[] > {
    const searchResults = this.searchBrowserService.searchResults;
    const workspaceService = this.workspaceService;
    const result: ISearchTreeItem[] = [];
    let order = 0;

    if (!searchResults) {
      return result;
    }

    for (const searchResultArray of searchResults) {
      const uri = searchResultArray[0];
      const resultList = searchResultArray[1];
      const _uri = new URI(uri);
      const description = await workspaceService.asRelativePath(uri) || uri;

      if (!resultList || resultList.length < 1) {
        continue;
      }

      const node: ISearchTreeItem  = {
        description,
        expanded: true,
        id: uri,
        uri: _uri,
        name: _uri.displayName,
        order: order++,
        depth: 0,
        parent: undefined,
      };
      node.children = this.getChildrenNodes(resultList, _uri, node);
      node.badge = node.children.length;
      if (node.children.length > 10) {
        // 结果太多大于10 则默认折叠
        node.expanded = false;
      }
      result.push(node);
      node.children.forEach((child) => {
        result.push(child);
      });
    }

    return result;
  }

}
