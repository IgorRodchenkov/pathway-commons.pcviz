/*
  The CoSE layout was written by Gerardo Huck.

  Modifications tracked on Github.
*/

;(function($$) { 'use strict';

  var DEBUG;

  /**
   * @brief :  default layout options
   */
  var defaults = {
    // Called on `layoutready`
    ready               : function() {},

    // Called on `layoutstop`
    stop                : function() {},

    // Number of iterations between consecutive screen positions update (0 -> only updated on the end)
    refresh             : 0,
    
    // Whether to fit the network view after when done
    fit                 : true, 

    // Padding on fit
    padding             : 30, 


    // Whether to randomize node positions on the beginning
    randomize           : true,
    
    // Whether to use the JS console to print debug messages
    debug               : false,

    // Node repulsion (non overlapping) multiplier
    nodeRepulsion       : 10000,
    
    // Node repulsion (overlapping) multiplier
    nodeOverlap         : 10,
    
    // Ideal edge (non nested) length
    idealEdgeLength     : 10,
    
    // Divisor to compute edge forces
    edgeElasticity      : 100,
    
    // Nesting factor (multiplier) to compute ideal edge length for nested edges
    nestingFactor       : 5, 
    
    // Gravity force (constant)
    gravity             : 250, 
    
    // Maximum number of iterations to perform
    numIter             : 100,
    
    // Initial temperature (maximum node displacement)
    initialTemp         : 200,
    
    // Cooling factor (how the temperature is reduced between consecutive iterations
    coolingFactor       : 0.95, 
    
    // Lower temperature threshold (below this point the layout will end)
    minTemp             : 1
  };


  /**
   * @brief       : constructor
   * @arg options : object containing layout options
   */
  function CoseLayout(options) {
    this.options = $$.util.extend({}, defaults, options); 
  }


  /**
   * @brief : runs the layout
   */
  CoseLayout.prototype.run = function() {
    var options = this.options;
    var cy      = options.cy;

    // Set DEBUG - Global variable
    if (true === options.debug) {
      DEBUG = true;
    } else {
      DEBUG = false;
    }

    // Get start time
    var startTime = new Date();

    // Initialize layout info
    var layoutInfo = createLayoutInfo(cy, options);
    
    groupDegreeZeroMembers();

    // get complex ordering by finding the inner one first
    var complexOrder = performDFSOnComplexes(layoutInfo, cy, options);
    
    // clear children of each complex
    var childGraphMap = clearComplexes(complexOrder);

    // tile the removed children
    var tiledMemberPack = tileComplexMembers(layoutInfo, childGraphMap);
       
    // Show LayoutInfo contents if debugging
    if (DEBUG) {
      printLayoutInfo(layoutInfo);
    }

    // If required, randomize node positions
    if (true === options.randomize) {
      randomizePositions(layoutInfo, cy);

      if (0 < options.refresh) {
        refreshPositions(layoutInfo, cy, options);
      }
    }

    updatePositions(layoutInfo, cy, options);

    // Main loop
    for (var i = 0; i < options.numIter; i++) {
      // Do one step in the phisical simulation
      step(layoutInfo, cy, options, i);

      // If required, update positions
      if (0 < options.refresh && 0 === (i % options.refresh)) {
        refreshPositions(layoutInfo, cy, options);
      }
      
      // Update temperature
      layoutInfo.temperature = layoutInfo.temperature * options.coolingFactor;
      logDebug("New temperature: " + layoutInfo.temperature);

      if (layoutInfo.temperature < options.minTemp) {
        logDebug("Temperature drop below minimum threshold. Stopping computation in step " + i);
        break;
      }
    }
    
    refreshPositions(layoutInfo, cy, options);

    // repopulate the complexes
    repopulateComplexes(cy, tiledMemberPack);

    // Fit the graph if necessary
    if (true === options.fit) {
      cy.fit( options.padding );
    }
    
    // Get end time
    var endTime = new Date();

    console.info('Layout took ' + (endTime - startTime) + ' ms');

    // Layout has finished
    cy.one('layoutstop', options.stop);
    cy.trigger('layoutstop');
  };
  
  /**
  * Make the child graph of each complex visible and adjust the orientations
  */    
  var repopulateComplexes = function(cy, tiledMemberPack) {
      for(var i in tiledMemberPack){
        var complex = cy.getElementById(i);

        adjustLocations(tiledMemberPack[i], complex._private.position.x, complex._private.position.y);
      
        complex._private.style.shape.value = "complex";
    }
  }
  
  /**
  * Tile the children nodes of each complex and set the estimated width and height values
  * for future layout operations
  */
  var tileComplexMembers = function(layoutInfo, childGraphMap) {
    var tiledMemberPack = [];
    
    for(var id in childGraphMap){
      // access layoutInfo nodes to set the width and height of complexes
      var complexNodeIndex  = layoutInfo.idToIndex[id];
      var complexNode = layoutInfo.layoutNodes[complexNodeIndex];
      
      tiledMemberPack[id] = tileNodes(cy.getElementById(id), childGraphMap[id]);
      
      complexNode.width = tiledMemberPack[id].width;
      complexNode.height = tiledMemberPack[id].height;
    }
    
    return tiledMemberPack;
  }
  
  /**
  * Adjust the location of nodes with respect to the given reference point. 
  */  
  var adjustLocations = function(organization, x, y) {
    for (var i = 0; i < organization.rows.length; i++) {
      var row = organization.rows[i];
      
      for (var j = 0; j < row.length; j++){
        // put the removed node back
        row[j].restore();
      }
    }
  }

  /**
  * Removes children of each complex in the given list. Return a map of 
  * complexes and their children.
  */
  var clearComplexes = function(complexOrder) {  
    var childGraphMap = [];
  
    for(var i = 0; i < complexOrder.length; i++) {
      var removedChildren = complexOrder[i].children().remove();  
      childGraphMap[complexOrder[i].id()] = removedChildren;
    }
  
    return childGraphMap;
  }
    
  /**
   * Scans the rows of an organization and returns the one with the min width
   */
  var getShortestRowIndex = function(organization) {
    var r = -1;
    var min = Number.MAX_VALUE;

    for (var i = 0; i < organization.rows.length; i++) {
      if (organization.rowWidth[i] < min){
        r = i;
        min = organization.rowWidth[i];
      }
    }
    return r;
  }

  /**
   * Scans the rows of an organization and returns the one with the max width
   */
  var getLongestRowIndex = function(organization) {
    var r = -1;
    var max = Number.MIN_VALUE;

    for (var i = 0; i < organization.rows.length; i++) {
    
      if (organization.rowWidth[i] > max) {
        r = i;
        max = organization.rowWidth[i];
      }
      
    }

    return r;
  }

  /**
  * This method checks whether adding extra width to the organization violates
  * the aspect ratio(1) or not.
  */    
  var canAddHorizontal = function(organization, extraWidth, extraHeight) {
    var sri = getShortestRowIndex(organization);

    if (sri < 0) {
      return true;
    }
    
    var min = organization.rowWidth[sri];

    if (organization.width - min >= extraWidth + organization.horizontalPadding)  {
      return true;
    }

    return organization.height + organization.verticalPadding
        + extraHeight > min + extraWidth + organization.horizontalPadding;
  }
    
  /**
   * Finds the maximum height of each row, adds them and updates the height of
   * the bounding box with the found value.
   */
  var updateHeight = function(organization) {   
    var totalHeight = 2 * organization.complexMargin;

    for (var i = 0; i < organization.rows.length; i++) {
      var maxHeight = 0;
      var r = organization.rows[i];

      for (var j = 0; j < r.length; j++) {
        if (r[j].height() > maxHeight)
          maxHeight = r[j].height();
      }

      totalHeight += (maxHeight + organization.verticalPadding);
    }
    organization.height = totalHeight;
  }
    
  /**
   * If moving the last node from the longest row and adding it to the last
   * row makes the bounding box smaller, do it.
   */
  var shiftToLastRow = function(organization) {
    var longest = getLongestRowIndex(organization);
    var last = organization.rowWidth.length - 1;
    var row = organization.rows[longest];
    var node = row[row.length -1];

    var diff = node.width() + organization.horizontalPadding;

    // check if there is enough space on the last row
    if (organization.width - organization.rowWidth[last] > diff) {
      // remove the last element of the longest row
      row.splice(-1, 1);
      
      // push it to the last row
      organization.rows[last].push(node);
      
      organization.rowWidth[longest] = organization.rowWidth[longest] - diff;
      organization.rowWidth[last] = organization.rowWidth[last] + diff;
      organization.width = organization.rowWidth[getLongestRowIndex(organization)];

      updateHeight(organization);
      shiftToLastRow(organization);
    }
  }
    
  /**
   * This method performs tiling. If a new row is needed, it creates the row
   * and places the new node there. Otherwise, it places the node to the end
   * of the specified row.
   */
  var insertNodeToRow = function(organization, node, rowIndex) {
    var minComplexWidth = 10;
    
    // Add new row if needed
    if (rowIndex == organization.rows.length) {
      if (organization.rows.length > 0) {
        organization.height += organization.verticalPadding;
      }
      
      var secondDimension = [];
      organization.rows.push(secondDimension);
      
      organization.height += node.height();

      organization.rowWidth.push(minComplexWidth);
    }

    // Update row width
    var w = organization.rowWidth[rowIndex] + node.width();

    if (organization.rows[rowIndex].length > 0) {
      w += organization.horizontalPadding;
    }
    
    organization.rowWidth[rowIndex] = w;

    // Insert node
    organization.rows[rowIndex].push(node);


    updateHeight(organization);

    // Update complex width
    if (organization.width < w) {
      organization.width = w;
    }
  }
  
  /**
  * This method places each node in the given list.
  */
  var tileNodes = function (complexNode, nodes) {
    var organization = {
      rows: [], 
      rowWidth: [], 
      verticalPadding: 10,
      horizontalPadding: 10,
      complexMargin: 10,
      width: 20, 
      height: 20
    // did not work, the values are 0.
    //  verticalPadding: complexNode._private.style["padding-left"].pxValue, 
    //  horizontalPadding: complexNode._private.style["padding-right"].pxValue
    };
  
    for( var i = 0; i < nodes.length; i++) {
      var node = nodes[i];

      if (organization.rows.length == 0) {
        insertNodeToRow(organization, node, 0);
      }
      else if (canAddHorizontal(organization, node.width(), node.height())) {
        insertNodeToRow(organization, node, getShortestRowIndex(organization));
      } 
      else {
        insertNodeToRow(organization, node, organization.rows.length);
      }
    
      shiftToLastRow(organization);
    }
  
    return organization;
  }
  
  /**
  * This method finds all the roots in the graph and performs depth first search
  * to find all complexes.
  */
  var performDFSOnComplexes = function(layoutInfo, cy, options) {  
    var complexOrder = [];
    
    // find roots
    var roots = cy.filter( function(i, ele){
      if(ele.isParent() == true)
        return true;
      return false;
    });
    
    // perform dfs
    cy.elements().dfs(roots, function(i, depth){
      if( this.is("[sbgnclass='complex']") ){
        complexOrder.push(this);
      }
    }, options.directed);
    
    return complexOrder;
  }

  /**
   * @brief : called on continuous layouts to stop them before they finish
   */
  CoseLayout.prototype.stop = function(){
    var options = this.options;

    cy.one('layoutstop', options.stop);
    cy.trigger('layoutstop');
  };


  /**
   * @brief     : Creates an object which is contains all the data
   *              used in the layout process
   * @arg cy    : cytoscape.js object
   * @return    : layoutInfo object initialized
   */
  var createLayoutInfo = function(cy, options) {
    var layoutInfo   = {
      layoutNodes  : [], 
      idToIndex    : {},
      nodeSize     : cy.nodes().size(),
      graphSet     : [],
      indexToGraph : [], 
      layoutEdges  : [],
      edgeSize     : cy.edges().size(),
      temperature  : options.initialTemp,
      clientWidth  : cy.container().clientWidth,
      clientHeight : cy.container().clientHeight
    }; 
    
    // Shortcut
    var nodes = cy.nodes();
    
    // Iterate over all nodes, creating layout nodes
    for (var i = 0; i < layoutInfo.nodeSize; i++) {
      var tempNode        = {};
      tempNode.id         = nodes[i].data('id');
      tempNode.parentId   = nodes[i].data('parent');      
      tempNode.children   = [];
      tempNode.positionX  = nodes[i].position('x');
      tempNode.positionY  = nodes[i].position('y');
      tempNode.offsetX    = 0;      
      tempNode.offsetY    = 0;
      tempNode.height     = nodes[i].height();
      tempNode.width      = nodes[i].width();
      tempNode.maxX       = tempNode.positionX + tempNode.width  / 2;
      tempNode.minX       = tempNode.positionX - tempNode.width  / 2;
      tempNode.maxY       = tempNode.positionY + tempNode.height / 2;
      tempNode.minY       = tempNode.positionY - tempNode.height / 2;
      tempNode.padLeft    = nodes[i]._private.style['padding-left'].pxValue;
      tempNode.padRight   = nodes[i]._private.style['padding-right'].pxValue;
      tempNode.padTop     = nodes[i]._private.style['padding-top'].pxValue;
      tempNode.padBottom  = nodes[i]._private.style['padding-bottom'].pxValue;
      
      // Add new node
      layoutInfo.layoutNodes.push(tempNode);
      // Add entry to id-index map
      layoutInfo.idToIndex[tempNode.id] = i;
    }

    // Inline implementation of a queue, used for traversing the graph in BFS order
    var queue = [];
    var start = 0;   // Points to the start the queue
    var end   = -1;  // Points to the end of the queue

    var tempGraph = [];

    // Second pass to add child information and 
    // initialize queue for hierarchical traversal
    for (var i = 0; i < layoutInfo.nodeSize; i++) {
      var n = layoutInfo.layoutNodes[i];
      var p_id = n.parentId;
      // Check if node n has a parent node
      if (null != p_id) {
      // Add node Id to parent's list of children
      layoutInfo.layoutNodes[layoutInfo.idToIndex[p_id]].children.push(n.id);
      } else {
      // If a node doesn't have a parent, then it's in the root graph
      queue[++end] = n.id;
      tempGraph.push(n.id);    
      }
    }
    
    // Add root graph to graphSet
    layoutInfo.graphSet.push(tempGraph);

    // Traverse the graph, level by level, 
    while (start <= end) {
      // Get the node to visit and remove it from queue
      var node_id  = queue[start++];
      var node_ix  = layoutInfo.idToIndex[node_id];
      var node     = layoutInfo.layoutNodes[node_ix];
      var children = node.children;
      if (children.length > 0) {
      // Add children nodes as a new graph to graph set
      layoutInfo.graphSet.push(children);
      // Add children to que queue to be visited
      for (var i = 0; i < children.length; i++) {
        queue[++end] = children[i];
      }
      }
    }

    // Create indexToGraph map
    for (var i = 0; i < layoutInfo.graphSet.length; i++) {      
      var graph = layoutInfo.graphSet[i];
      for (var j = 0; j < graph.length; j++) {
      var index = layoutInfo.idToIndex[graph[j]];
      layoutInfo.indexToGraph[index] = i;
      }
    }

    // Shortcut
    var edges = cy.edges();
    
    // Iterate over all edges, creating Layout Edges
    for (var i = 0; i < layoutInfo.edgeSize; i++) {
      var e = edges[i];
      var tempEdge = {};      
      tempEdge.id       = e.data('id');
      tempEdge.sourceId = e.data('source');
      tempEdge.targetId = e.data('target');

      // Compute ideal length
      var idealLength = options.idealEdgeLength;

      // Check if it's an inter graph edge
      var sourceIx    = layoutInfo.idToIndex[tempEdge.sourceId];
      var targetIx    = layoutInfo.idToIndex[tempEdge.targetId];
      var sourceGraph = layoutInfo.indexToGraph[sourceIx];
      var targetGraph = layoutInfo.indexToGraph[targetIx];

      if (sourceGraph != targetGraph) {
      // Find lowest common graph ancestor
      var lca = findLCA(tempEdge.sourceId, tempEdge.targetId, layoutInfo);

      // Compute sum of node depths, relative to lca graph
      var lcaGraph = layoutInfo.graphSet[lca];
      var depth    = 0;

      // Source depth
      var tempNode = layoutInfo.layoutNodes[sourceIx];
      while (-1 === $.inArray(tempNode.id, lcaGraph)) {
        tempNode = layoutInfo.layoutNodes[layoutInfo.idToIndex[tempNode.parentId]];
        depth++;
      }

      // Target depth
      tempNode = layoutInfo.layoutNodes[targetIx];
      while (-1 === $.inArray(tempNode.id, lcaGraph)) {
        tempNode = layoutInfo.layoutNodes[layoutInfo.idToIndex[tempNode.parentId]];
        depth++;
      }

      logDebug('LCA of nodes ' + tempEdge.sourceId + ' and ' + tempEdge.targetId +  
         ". Index: " + lca + " Contents: " + lcaGraph.toString() + 
         ". Depth: " + depth);

      // Update idealLength
      idealLength *= depth * options.nestingFactor;
      }

      tempEdge.idealLength = idealLength;

      layoutInfo.layoutEdges.push(tempEdge);
    }

    // Finally, return layoutInfo object
    return layoutInfo;
  };

  
  /**
   * @brief : This function finds the index of the lowest common 
   *          graph ancestor between 2 nodes in the subtree 
   *          (from the graph hierarchy induced tree) whose
   *          root is graphIx
   *
   * @arg node1: node1's ID
   * @arg node2: node2's ID
   * @arg layoutInfo: layoutInfo object
   *
   */
  var findLCA = function(node1, node2, layoutInfo) {
    // Find their common ancester, starting from the root graph
    var res = findLCA_aux(node1, node2, 0, layoutInfo);
    if (2 > res.count) {
      // If aux function couldn't find the common ancester, 
      // then it is the root graph
      return 0;
    } else {
      return res.graph;
    }
  };


  /**
   * @brief          : Auxiliary function used for LCA computation
   * 
   * @arg node1      : node1's ID
   * @arg node2      : node2's ID
   * @arg graphIx    : subgraph index
   * @arg layoutInfo : layoutInfo object
   *
   * @return         : object of the form {count: X, graph: Y}, where:
   *                   X is the number of ancesters (max: 2) found in 
   *                   graphIx (and it's subgraphs),
   *                   Y is the graph index of the lowest graph containing 
   *                   all X nodes
   */
  var findLCA_aux = function(node1, node2, graphIx, layoutInfo) {
    var graph = layoutInfo.graphSet[graphIx];
    // If both nodes belongs to graphIx
    if (-1 < $.inArray(node1, graph) && -1 < $.inArray(node2, graph)) {
      return {count:2, graph:graphIx};
    }

    // Make recursive calls for all subgraphs
    var c = 0;
    for (var i = 0; i < graph.length; i++) {
      var nodeId   = graph[i];
      var nodeIx   = layoutInfo.idToIndex[nodeId];
      var children = layoutInfo.layoutNodes[nodeIx].children;

      // If the node has no child, skip it
      if (0 === children.length) {
      continue;
      }

      var childGraphIx = layoutInfo.indexToGraph[layoutInfo.idToIndex[children[0]]];
      var result = findLCA_aux(node1, node2, childGraphIx, layoutInfo);
      if (0 === result.count) {
      // Neither node1 nor node2 are present in this subgraph
      continue;
      } else if (1 === result.count) {
      // One of (node1, node2) is present in this subgraph
      c++;
      if (2 === c) {
        // We've already found both nodes, no need to keep searching
        break;
      }
      } else {
      // Both nodes are present in this subgraph
      return result;
      }      
    }
    
    return {count:c, graph:graphIx};
  };


  /**
   * @brief: printsLayoutInfo into js console
   *         Only used for debbuging 
   */
  var printLayoutInfo = function(layoutInfo) {
    if (!DEBUG) {
      return;
    }
    console.debug("layoutNodes:");
    for (var i = 0; i < layoutInfo.nodeSize; i++) {
      var n = layoutInfo.layoutNodes[i];
      var s = 
      "\nindex: "     + i + 
      "\nId: "        + n.id + 
      "\nChildren: "  + n.children.toString() +  
      "\nparentId: "  + n.parentId  + 
      "\npositionX: " + n.positionX + 
      "\npositionY: " + n.positionY +
      "\nOffsetX: " + n.offsetX + 
      "\nOffsetY: " + n.offsetY + 
      "\npadLeft: " + n.padLeft + 
      "\npadRight: " + n.padRight + 
      "\npadTop: " + n.padTop + 
      "\npadBottom: " + n.padBottom;

      console.debug(s);    
    }  
    
    console.debug('idToIndex');
    for (var i in layoutInfo.idToIndex) {
      console.debug("Id: " + i + "\nIndex: " + layoutInfo.idToIndex[i]);
    }

    console.debug('Graph Set');
    var set = layoutInfo.graphSet;
    for (var i = 0; i < set.length; i ++) {
      console.debug("Set : " + i + ": " + set[i].toString());
    } 

    var s = 'IndexToGraph';
    for (var i = 0; i < layoutInfo.indexToGraph.length; i ++) {
      s += "\nIndex : " + i + " Graph: "+ layoutInfo.indexToGraph[i];
    }
    console.debug(s);

    s = 'Layout Edges';
    for (var i = 0; i < layoutInfo.layoutEdges.length; i++) {
      var e = layoutInfo.layoutEdges[i];
      s += "\nEdge Index: " + i + " ID: " + e.id + 
      " SouceID: " + e.sourceId + " TargetId: " + e.targetId + 
      " Ideal Length: " + e.idealLength;
    }
    console.debug(s);

    s =  "nodeSize: " + layoutInfo.nodeSize;
    s += "\nedgeSize: " + layoutInfo.edgeSize;
    s += "\ntemperature: " + layoutInfo.temperature;
    console.debug(s);

    return;
  };


  /**
   * @brief : Randomizes the position of all nodes
   */
  var randomizePositions = function(layoutInfo, cy) {
    var width     = layoutInfo.clientWidth;
    var height    = layoutInfo.clientHeight;

    for (var i = 0; i < layoutInfo.nodeSize; i++) {
      var n = layoutInfo.layoutNodes[i];
      // No need to randomize compound nodes
      if (true || 0 === n.children.length) {
        n.positionX = Math.random() * width;
        n.positionY = Math.random() * height;
      }
    }
  };

  
  /**
   * @brief          : Updates the positions of nodes in the network
   * @arg layoutInfo : LayoutInfo object
   * @arg cy         : Cytoscape object
   * @arg options    : Layout options
   */
  var refreshPositions = function(layoutInfo, cy, options) {  
    var s = 'Refreshing positions';
    logDebug(s);

    cy.nodes().positions(function(i, ele) {
      var lnode = layoutInfo.layoutNodes[layoutInfo.idToIndex[ele.data('id')]];
      s = "Node: " + lnode.id + ". Refreshed position: (" + 
      lnode.positionX + ", " + lnode.positionY + ").";
      logDebug(s);
      return {
        x: lnode.positionX,
        y: lnode.positionY
      };
    });

    // Trigger layoutReady only on first call
    if (true !== layoutInfo.ready) {
      s = 'Triggering layoutready';
      logDebug(s);
      layoutInfo.ready = true;
      cy.one('layoutready', options.ready);
      cy.trigger('layoutready');
    }
  };


  /**
   * @brief          : Performs one iteration of the physical simulation
   * @arg layoutInfo : LayoutInfo object already initialized
   * @arg cy         : Cytoscape object
   * @arg options    : Layout options
   */
  var step = function(layoutInfo, cy, options, step) {  
    var s = "\n\n###############################";
    s += "\nSTEP: " + step;
    s += "\n###############################\n";
    logDebug(s);

    // Calculate node repulsions
    calculateNodeForces(layoutInfo, cy, options);
    // Calculate edge forces
    calculateEdgeForces(layoutInfo, cy, options);
    // Calculate gravity forces
    calculateGravityForces(layoutInfo, cy, options);
    // Propagate forces from parent to child
    propagateForces(layoutInfo, cy, options);
    // Update positions based on calculated forces
    updatePositions(layoutInfo, cy, options);
  };

  
  /**
   * @brief : Computes the node repulsion forces
   */
  var calculateNodeForces = function(layoutInfo, cy, options) {
    // Go through each of the graphs in graphSet
    // Nodes only repel each other if they belong to the same graph
    var s = 'calculateNodeForces';
    logDebug(s);
    for (var i = 0; i < layoutInfo.graphSet.length; i ++) {
      var graph    = layoutInfo.graphSet[i];
      var numNodes = graph.length;

      s = "Set: " + graph.toString();
      logDebug(s);

      // Now get all the pairs of nodes 
      // Only get each pair once, (A, B) = (B, A)
      for (var j = 0; j < numNodes; j++) {
      var node1 = layoutInfo.layoutNodes[layoutInfo.idToIndex[graph[j]]];
      for (var k = j + 1; k < numNodes; k++) {
        var node2 = layoutInfo.layoutNodes[layoutInfo.idToIndex[graph[k]]];
        nodeRepulsion(node1, node2, layoutInfo, cy, options);
      } 
      }
    } 
  };


  /**
   * @brief : Compute the node repulsion forces between a pair of nodes
   */
  var nodeRepulsion = function(node1, node2, layoutInfo, cy, options) {
    var s = "Node repulsion. Node1: " + node1.id + " Node2: " + node2.id;

    // Get direction of line connecting both node centers
    var directionX = node2.positionX - node1.positionX;
    var directionY = node2.positionY - node1.positionY;
    s += "\ndirectionX: " + directionX + ", directionY: " + directionY;

    // If both centers are the same, apply a random force
    if (0 === directionX && 0 === directionY) {
      s += "\nNodes have the same position.";
      return; // TODO
    }

    var overlap = nodesOverlap(node1, node2, directionX, directionY);
    
    if (overlap > 0) {
      s += "\nNodes DO overlap.";
      s += "\nOverlap: " + overlap;
      // If nodes overlap, repulsion force is proportional 
      // to the overlap
      var force    = options.nodeOverlap * overlap;

      // Compute the module and components of the force vector
      var distance = Math.sqrt(directionX * directionX + directionY * directionY);
      s += "\nDistance: " + distance;
      var forceX   = force * directionX / distance;
      var forceY   = force * directionY / distance;

    } else {
      s += "\nNodes do NOT overlap.";
      // If there's no overlap, force is inversely proportional 
      // to squared distance

      // Get clipping points for both nodes
      var point1 = findClippingPoint(node1, directionX, directionY);
      var point2 = findClippingPoint(node2, -1 * directionX, -1 * directionY);

      // Use clipping points to compute distance
      var distanceX   = point2.x - point1.x;
      var distanceY   = point2.y - point1.y;
      var distanceSqr = distanceX * distanceX + distanceY * distanceY;
      var distance    = Math.sqrt(distanceSqr);
      s += "\nDistance: " + distance;

      // Compute the module and components of the force vector
      var force  = options.nodeRepulsion / distanceSqr;
      var forceX = force * distanceX / distance;
      var forceY = force * distanceY / distance;
    }

    // Apply force
    node1.offsetX -= forceX;
    node1.offsetY -= forceY;
    node2.offsetX += forceX;
    node2.offsetY += forceY;

    s += "\nForceX: " + forceX + " ForceY: " + forceY;
    logDebug(s);

    return;
  };


  /**
   * @brief : Finds the point in which an edge (direction dX, dY) intersects 
   *          the rectangular bounding box of it's source/target node 
   */
  var findClippingPoint = function(node, dX, dY) {

    // Shorcuts
    var X = node.positionX;
    var Y = node.positionY;
    var H = node.height;
    var W = node.width;
    var dirSlope     = dY / dX;
    var nodeSlope    = H / W;

    var s = 'Computing clipping point of node ' + node.id + 
      " . Height:  " + H + ", Width: " + W + 
      "\nDirection " + dX + ", " + dY; 
    
    // Compute intersection
    var res = {};
    do {
      // Case: Vertical direction (up)
      if (0 === dX && 0 < dY) {
        res.x = X;
        s += "\nUp direction";
        res.y = Y + H / 2;
        break;
      }

      // Case: Vertical direction (down)
      if (0 === dX && 0 > dY) {
        res.x = X;
        res.y = Y + H / 2;
        s += "\nDown direction";
        break;
      }      

      // Case: Intersects the right border
      if (0 < dX && 
      -1 * nodeSlope <= dirSlope && 
      dirSlope <= nodeSlope) {
        res.x = X + W / 2;
        res.y = Y + (W * dY / 2 / dX);
        s += "\nRightborder";
        break;
      }

      // Case: Intersects the left border
      if (0 > dX && 
      -1 * nodeSlope <= dirSlope && 
      dirSlope <= nodeSlope) {
        res.x = X - W / 2;
        res.y = Y - (W * dY / 2 / dX);
        s += "\nLeftborder";
        break;
      }

      // Case: Intersects the top border
      if (0 < dY && 
      ( dirSlope <= -1 * nodeSlope ||
        dirSlope >= nodeSlope )) {
        res.x = X + (H * dX / 2 / dY);
        res.y = Y + H / 2;
        s += "\nTop border";
        break;
      }

      // Case: Intersects the bottom border
      if (0 > dY && 
      ( dirSlope <= -1 * nodeSlope ||
        dirSlope >= nodeSlope )) {
        res.x = X - (H * dX / 2 / dY);
        res.y = Y - H / 2;
        s += "\nBottom border";
        break;
      }

    } while (false);

    s += "\nClipping point found at " + res.x + ", " + res.y;
    logDebug(s);
    return res;
  };


  /**
   * @brief  : Determines whether two nodes overlap or not
   * @return : Amount of overlapping (0 => no overlap)
   */
  var nodesOverlap = function(node1, node2, dX, dY) {

    if (dX > 0) {
      var overlapX = node1.maxX - node2.minX;
    } else {
      var overlapX = node2.maxX - node1.minX;
    }

    if (dY > 0) {
      var overlapY = node1.maxY - node2.minY;
    } else {
      var overlapY = node2.maxY - node1.minY;
    }

    if (overlapX >= 0 && overlapY >= 0) {
      return Math.sqrt(overlapX * overlapX + overlapY * overlapY);
    } else {
      return 0;
    }
  };
    
  
  /**
   * @brief : Calculates all edge forces
   */
  var calculateEdgeForces = function(layoutInfo, cy, options) {
    // Iterate over all edges
    for (var i = 0; i < layoutInfo.edgeSize; i++) {
      // Get edge, source & target nodes
      var edge     = layoutInfo.layoutEdges[i];
      var sourceIx = layoutInfo.idToIndex[edge.sourceId];
      var source   = layoutInfo.layoutNodes[sourceIx];
      var targetIx = layoutInfo.idToIndex[edge.targetId];
      var target   = layoutInfo.layoutNodes[targetIx];

      // Get direction of line connecting both node centers
      var directionX = target.positionX - source.positionX;
      var directionY = target.positionY - source.positionY;
      
      // If both centers are the same, do nothing.
      // A random force has already been applied as node repulsion
      if (0 === directionX && 0 === directionY) {
      return;
      }

      // Get clipping points for both nodes
      var point1 = findClippingPoint(source, directionX, directionY);
      var point2 = findClippingPoint(target, -1 * directionX, -1 * directionY);


      var lx = point2.x - point1.x;
      var ly = point2.y - point1.y;
      var l  = Math.sqrt(lx * lx + ly * ly);

      var force  = Math.pow(edge.idealLength - l, 2) / options.edgeElasticity; 

      if (0 !== l) {
        var forceX = force * lx / l;
        var forceY = force * ly / l;
      } else {
        var forceX = 0;
        var forceY = 0;
      }

      // Add this force to target and source nodes
      source.offsetX += forceX;
      source.offsetY += forceY;
      target.offsetX -= forceX;
      target.offsetY -= forceY;

      var s = 'Edge force between nodes ' + source.id + ' and ' + target.id;
      s += "\nDistance: " + l + " Force: (" + forceX + ", " + forceY + ")";
      logDebug(s);
    }
  };


  /**
   * @brief : Computes gravity forces for all nodes
   */
  var calculateGravityForces = function(layoutInfo, cy, options) {
    var s = 'calculateGravityForces';
    logDebug(s);
    for (var i = 0; i < layoutInfo.graphSet.length; i ++) {
      var graph    = layoutInfo.graphSet[i];
      var numNodes = graph.length;

      s = "Set: " + graph.toString();
      logDebug(s);
          
      // Compute graph center
      if (0 === i) {
        var centerX   = layoutInfo.clientHeight / 2;
        var centerY   = layoutInfo.clientWidth  / 2;    
      } else {
        // Get Parent node for this graph, and use its position as center
        var temp    = layoutInfo.layoutNodes[layoutInfo.idToIndex[graph[0]]];
        var parent  = layoutInfo.layoutNodes[layoutInfo.idToIndex[temp.parentId]];
        var centerX = parent.positionX;
        var centerY = parent.positionY;
      }
      s = "Center found at: " + centerX + ", " + centerY;
      logDebug(s);

      // Apply force to all nodes in graph
      for (var j = 0; j < numNodes; j++) {
        var node = layoutInfo.layoutNodes[layoutInfo.idToIndex[graph[j]]];
        s = "Node: " + node.id;
        var dx = centerX - node.positionX;
        var dy = centerY - node.positionY;
        var d  = Math.sqrt(dx * dx + dy * dy);
        if (d > 1.0) { // TODO: Use global variable for distance threshold
          var fx = options.gravity * dx / d;
          var fy = options.gravity * dy / d;
          node.offsetX += fx;
          node.offsetY += fy;
          s += ": Applied force: " + fx + ", " + fy;
        } else {
          s += ": skypped since it's too close to center";
        }
        logDebug(s);
      }
    }
  };


  /**
   * @brief          : This function propagates the existing offsets from 
   *                   parent nodes to its descendents.
   * @arg layoutInfo : layoutInfo Object
   * @arg cy         : cytoscape Object
   * @arg options    : Layout options
   */
  var propagateForces = function(layoutInfo, cy, options) {  
    // Inline implementation of a queue, used for traversing the graph in BFS order
    var queue = [];
    var start = 0;   // Points to the start the queue
    var end   = -1;  // Points to the end of the queue

    logDebug('propagateForces');

    // Start by visiting the nodes in the root graph
    queue.push.apply(queue, layoutInfo.graphSet[0]);
    end += layoutInfo.graphSet[0].length;

    // Traverse the graph, level by level, 
    while (start <= end) {
      // Get the node to visit and remove it from queue
      var nodeId    = queue[start++];
      var nodeIndex = layoutInfo.idToIndex[nodeId];
      var node      = layoutInfo.layoutNodes[nodeIndex];
      var children  = node.children;

      // We only need to process the node if it's compound
      if (0 < children.length) {    
      var offX = node.offsetX;
      var offY = node.offsetY;

      var s = "Propagating offset from parent node : " + node.id + 
        ". OffsetX: " + offX + ". OffsetY: " + offY;
      s += "\n Children: " + children.toString();
      logDebug(s);
      
      for (var i = 0; i < children.length; i++) {
        var childNode = layoutInfo.layoutNodes[layoutInfo.idToIndex[children[i]]];
        // Propagate offset
        childNode.offsetX += offX;
        childNode.offsetY += offY;
        // Add children to queue to be visited
        queue[++end] = children[i];
      }
      
      // Reset parent offsets
      node.offsetX = 0;
      node.offsetY = 0;
      }
      
    }
  };


  /**
   * @brief : Updates the layout model positions, based on 
   *          the accumulated forces
   */
  var updatePositions = function(layoutInfo, cy, options) {
    var s = 'Updating positions';
    logDebug(s);

    // Reset boundaries for compound nodes
    for (var i = 0; i < layoutInfo.nodeSize; i++) {
      var n = layoutInfo.layoutNodes[i];
      if (0 < n.children.length) {
      logDebug("Resetting boundaries of compound node: " + n.id);
      n.maxX = undefined;
      n.minX = undefined;
      n.maxY = undefined;
      n.minY = undefined;
      }
    }

    for (var i = 0; i < layoutInfo.nodeSize; i++) {
      var n = layoutInfo.layoutNodes[i];
      if (0 < n.children.length) {
      // No need to set compound node position
      logDebug("Skipping position update of node: " + n.id);
      continue;
      }
      s = "Node: " + n.id + " Previous position: (" + 
      n.positionX + ", " + n.positionY + ")."; 

      // Limit displacement in order to improve stability
      var tempForce = limitForce(n.offsetX, n.offsetY, layoutInfo.temperature);
      n.positionX += tempForce.x; 
      n.positionY += tempForce.y;
      n.offsetX = 0;
      n.offsetY = 0;
      n.minX    = n.positionX - n.width; 
      n.maxX    = n.positionX + n.width; 
      n.minY    = n.positionY - n.height; 
      n.maxY    = n.positionY + n.height; 
      s += " New Position: (" + n.positionX + ", " + n.positionY + ").";
      logDebug(s);

      // Update ancestry boudaries
      updateAncestryBoundaries(n, layoutInfo);
    }

    // Update size, position of compund nodes
    for (var i = 0; i < layoutInfo.nodeSize; i++) {
      var n = layoutInfo.layoutNodes[i];
      if (0 < n.children.length) {
      n.positionX = (n.maxX + n.minX) / 2;
      n.positionY = (n.maxY + n.minY) / 2;
      n.width     = n.maxX - n.minX;
      n.height    = n.maxY - n.minY;
      s = "Updating position, size of compound node " + n.id;
      s += "\nPositionX: " + n.positionX + ", PositionY: " + n.positionY;
      s += "\nWidth: " + n.width + ", Height: " + n.height;
      logDebug(s);
      }
    }  
  };


  /**
   * @brief : Limits a force (forceX, forceY) to be not 
   *          greater (in modulo) than max. 
   8          Preserves force direction. 
   */
  var limitForce = function(forceX, forceY, max) {
    var s = "Limiting force: (" + forceX + ", " + forceY + "). Max: " + max;
    var force = Math.sqrt(forceX * forceX + forceY * forceY);

    if (force > max) {
      var res = {
      x : max * forceX / force,
      y : max * forceY / force
      };      

    } else {
      var res = {
      x : forceX,
      y : forceY
      };
    }

    s += ".\nResult: (" + res.x + ", " + res.y + ")";
    logDebug(s);

    return res;
  };


  /**
   * @brief : Function used for keeping track of compound node 
   *          sizes, since they should bound all their subnodes.
   */
  var updateAncestryBoundaries = function(node, layoutInfo) {
    var s = "Propagating new position/size of node " + node.id;
    var parentId = node.parentId;
    if (null == parentId) {
      // If there's no parent, we are done
      s += ". No parent node.";
      logDebug(s);
      return;
    }

    // Get Parent Node
    var p = layoutInfo.layoutNodes[layoutInfo.idToIndex[parentId]];
    var flag = false;

    // MaxX
    if (null == p.maxX || node.maxX + p.padRight > p.maxX) {
      p.maxX = node.maxX + p.padRight;
      flag = true;
      s += "\nNew maxX for parent node " + p.id + ": " + p.maxX;
    }

    // MinX
    if (null == p.minX || node.minX - p.padLeft < p.minX) {
      p.minX = node.minX - p.padLeft;
      flag = true;
      s += "\nNew minX for parent node " + p.id + ": " + p.minX;
    }

    // MaxY
    if (null == p.maxY || node.maxY + p.padBottom > p.maxY) {
      p.maxY = node.maxY + p.padBottom;
      flag = true;
      s += "\nNew maxY for parent node " + p.id + ": " + p.maxY;
    }

    // MinY
    if (null == p.minY || node.minY - p.padTop < p.minY) {
      p.minY = node.minY - p.padTop;
      flag = true;
      s += "\nNew minY for parent node " + p.id + ": " + p.minY;
    }

    // If updated boundaries, propagate changes upward
    if (flag) {
      logDebug(s);
      return updateAncestryBoundaries(p, layoutInfo);
    } 

    s += ". No changes in boundaries/position of parent node " + p.id;  
    logDebug(s);
    return;
  };


  /**
   * @brief : Logs a debug message in JS console, if DEBUG is ON
   */
  var logDebug = function(text) {
    if (DEBUG) {
      console.debug(text);
    }
  };


  // register the layout
  $$('layout', 'cose', CoseLayout);

})(cytoscape);