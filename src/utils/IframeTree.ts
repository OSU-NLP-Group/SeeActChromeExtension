import {Logger} from "loglevel";
import {renderUnknownValue} from "./misc";
import {createNamedLogger} from "./shared_logging_setup";

/**
 * Represents a node in the iframe tree structure.
 */
export class IframeNode {
    iframe: HTMLIFrameElement | null;
    children: IframeNode[];
    parent: IframeNode | null;
    window: Window;
    coordsOffsetFromViewport: { x: number, y: number };

    /**
     * Creates an instance of IframeNode.
     * @param {HTMLIFrameElement | null} iframe - The iframe element, or null for the top-level window.
     * @param {Window} window - The Window object associated with this node.
     */
    constructor(iframe: HTMLIFrameElement | null, window: Window) {
        this.iframe = iframe;
        this.children = [];
        this.parent = null;
        this.window = window;
        if (iframe) {
            //these are just the coordinates of the iframe relative to the enclosing scope, which might be another iframe
            //The corrections for this will propagate through the addChild() calls
            const {x, y} =  iframe.getBoundingClientRect();
            this.coordsOffsetFromViewport = {x: x, y: y};
        } else {
            //root node of tree is for the top-level window (i.e. the one for the whole viewport)
            this.coordsOffsetFromViewport = {x: 0, y: 0};
        }
    }

    /**
     * Adds a child node under this node.
     * @param {IframeNode} child - The child node to add.
     */
    addChild(child: IframeNode): void {
        this.children.push(child);
        child.parent = this;
        child.coordsOffsetFromViewport.x += this.coordsOffsetFromViewport.x;
        child.coordsOffsetFromViewport.y += this.coordsOffsetFromViewport.y;
    }
}

/**
 * Represents the entire tree structure of iframes in the page.
 */
export class IframeTree {
    root: IframeNode;
    nodeMap: Map<Window, IframeNode>;

    logger: Logger;


    /**
     * Creates an instance of IframeTree and builds the tree structure.
     */
    constructor(topWindow: Window, logger?: Logger) {
        this.logger = logger ?? createNamedLogger('iframe-tree', false);
        this.root = new IframeNode(null, topWindow);
        this.nodeMap = new Map([[topWindow, this.root]]);
        this.buildTree();
    }

    /**
     * Recursively builds the tree structure of iframes.
     * @private
     */
    private buildTree(): void {
        const buildNodeRecursive = (node: IframeNode) => {
            const iframes = Array.from(node.window.document.getElementsByTagName('iframe'));
            for (const iframe of iframes) {
                try {
                    const currIframeContentWindow: Window | null = iframe.contentWindow;
                    if (currIframeContentWindow) {
                        const childNode = new IframeNode(iframe, currIframeContentWindow);
                        this.nodeMap.set(currIframeContentWindow, childNode);
                        //note - for coordinate offsets to be correct, the child must be added to its parent before we
                        // recurse on it
                        node.addChild(childNode);
                        buildNodeRecursive(childNode);
                    }
                } catch (error: any) {
                    if (error.name === "SecurityError") {
                        this.logger.debug(`Cross-origin (${iframe.src}) iframe detected while building iframe tree: ${
                            renderUnknownValue(error).slice(0, 100)}`);
                    } else {this.logger.error(`Error building iframe tree: ${renderUnknownValue(error)}`);}
                }
            }
        };

        const treeBuildStartTs = performance.now();
        try {
            buildNodeRecursive(this.root);
        } catch (error: any) {
            if (error.name === "SecurityError") {
                this.logger.debug(`Cross-origin iframe detected while building iframe tree for page: ${
                    renderUnknownValue(error).slice(0, 100)}`);
            } else {this.logger.error(`Error building iframe tree: ${renderUnknownValue(error)}`);}
        }
        const treeBuildDuration = performance.now() - treeBuildStartTs;
        (treeBuildDuration > 100 ? this.logger.warn : this.logger.debug )(`Iframe tree build time: ${treeBuildDuration.toFixed(5)}ms`);
    }

    /**
     * Finds the IframeNode corresponding to the window containing the given element.
     * @param {HTMLElement} element - The element to find the containing iframe for.
     * @returns {IframeNode | null} The corresponding IframeNode, or null if not found.
     */
    findIframeNodeForElement(element: HTMLElement): IframeNode | null {
        let currentWindow: Window | null = element.ownerDocument.defaultView;
        while (currentWindow) {
            const node = this.nodeMap.get(currentWindow);
            if (node) {return node;}
            if (currentWindow !== currentWindow.parent) {
                currentWindow = currentWindow.parent;
            } else {currentWindow = null;}
        }
        return null;
    }

    findIframeNodeForIframeElement(iframeElement: HTMLIFrameElement): IframeNode | null {
        let node = null;
        if (iframeElement.contentWindow) {node = this.nodeMap.get(iframeElement.contentWindow);}
        if (node === undefined) { node = null; }
        return node;
    }

    /**
     * Gets the path of IframeNodes from the root to the iframe containing the given element.
     * @param {HTMLElement} element - The element to find the iframe path for.
     * @returns {IframeNode[]} An array of IframeNodes representing the path, empty if not in an iframe.
     */
    getIframePathForElement(element: HTMLElement): IframeNode[] {
        const path: IframeNode[] = [];
        let currentNode: IframeNode | null = this.findIframeNodeForElement(element);
        while (currentNode && currentNode !== this.root) {
            path.unshift(currentNode);
            currentNode = currentNode.parent;
        }
        return path;
    }
}