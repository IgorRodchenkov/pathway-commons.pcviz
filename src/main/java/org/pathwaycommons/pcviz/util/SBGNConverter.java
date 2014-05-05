/*
 * Copyright 2013 Memorial-Sloan Kettering Cancer Center.
 *
 * This file is part of PCViz.
 *
 * PCViz is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * PCViz is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with PCViz. If not, see <http://www.gnu.org/licenses/>.
 */
package org.pathwaycommons.pcviz.util;

import java.util.*;

import org.biopax.paxtools.io.sbgn.L3ToSBGNPDConverter;
import org.biopax.paxtools.io.sbgn.ListUbiqueDetector;
import org.biopax.paxtools.model.Model;
import org.pathwaycommons.pcviz.model.CytoscapeJsEdge;
import org.pathwaycommons.pcviz.model.CytoscapeJsGraph;
import org.pathwaycommons.pcviz.model.CytoscapeJsNode;
import org.pathwaycommons.pcviz.model.PropertyKey;
import org.pathwaycommons.pcviz.service.BlackListService;
import org.sbgn.bindings.Arc;
import org.sbgn.bindings.Glyph;
import org.sbgn.bindings.Port;
import org.sbgn.bindings.Sbgn;

/**
 * @author Mecit Sari
 */
public class SBGNConverter
{

    private BlackListService blackListService;

    public BlackListService getBlackListService() {
        return blackListService;
    }

    public void setBlackListService(BlackListService bls) {
        this.blackListService = bls;
    }

    public void setGlyphPositionAsCenter(Glyph glyph, ArrayList<Glyph> states){
        //sbgnml positions are set as the beginning of the shape,
        //cytoscape.js accept as center, conversion in server side
        //is better
        glyph.getBbox().setX(glyph.getBbox().getX() + glyph.getBbox().getW()/2);
        glyph.getBbox().setY(glyph.getBbox().getY() + glyph.getBbox().getH()/2);

        //states position are set according to the center of the glyph itself.
        //it prevents recalculating it again and again when user moves the glyph
        setStateAndInfoPos(glyph,states);
    }

    public void setStateAndInfoPos(Glyph glyph, ArrayList<Glyph> states){
        float xPos = glyph.getBbox().getX();
        float yPos = glyph.getBbox().getY();

        for(Glyph state : states)
        {
            state.getBbox().setX(state.getBbox().getX() +
                    state.getBbox().getW()/2 - xPos);
            state.getBbox().setY(state.getBbox().getY() +
                    state.getBbox().getH()/2 - yPos);
        }
    }

    public void addGlyph(Glyph parent, Glyph glyph, ArrayList<Glyph> states,
        CytoscapeJsGraph graph, Collection<String> genes)
    {
        CytoscapeJsNode cNode = new CytoscapeJsNode();

        cNode.setProperty(PropertyKey.ID, glyph.getId());
        cNode.setProperty(PropertyKey.SBGNCLASS, glyph.getClazz());
        cNode.setProperty(PropertyKey.SBGNBBOX, glyph.getBbox());
        cNode.setProperty(PropertyKey.SBGNORIENTATION, glyph.getOrientation());
        cNode.setProperty(PropertyKey.SBGNCOMPARTMENTREF, glyph.getCompartmentRef());

        String lbl = (glyph.getLabel() == null) ? "unknown" : glyph.getLabel().getText();
        cNode.setProperty(PropertyKey.SBGNLABEL, lbl);

        setGlyphPositionAsCenter(glyph, states);
        cNode.setProperty(PropertyKey.SBGNSTATESANDINFOS, states);

        String parentLabel = (parent == null) ? "" : parent.getId();
        Glyph compartment = ((Glyph)glyph.getCompartmentRef());
        String compartmentLabel = (compartment == null) ? "" : compartment.getId();
        String parentId = (!parentLabel.equals("")) ? parentLabel : compartmentLabel;
        cNode.setProperty(PropertyKey.PARENT, parentId);

        boolean isSeed = genes.contains(lbl);
        cNode.setProperty(PropertyKey.ISSEED, isSeed);

        cNode.setProperty(PropertyKey.SBGNCLONEMARKER, glyph.getClone());

        graph.getNodes().add(cNode);
    }

    private void traverseAndAddGlyphs(Glyph parent, List<Glyph> nodes,
        CytoscapeJsGraph graph, Map<String, Glyph> portGlyphMap,
        Collection<String> genes)
    {
        for (Glyph node : nodes) {
            List<Glyph> glyphs = node.getGlyph();

            ArrayList<Glyph> states = new ArrayList<Glyph>();
            ArrayList<Glyph> childNodes = new ArrayList<Glyph>();

            for (Glyph glyph : glyphs)
            {
                if(glyph.getId().equals(node.getId()))
                    continue;
                if (glyph.getClazz().equals("unit of information") ||
                        glyph.getClazz().equals("state variable"))
                {
                    states.add(glyph);
                }
                else
                {
                    childNodes.add(glyph);
                }
            }

            for (Port p : node.getPort())
            {
                portGlyphMap.put(p.getId(), node);
            }

            addGlyph(parent, node, states, graph, genes);

            if (childNodes.size() > 0)
            {
                traverseAndAddGlyphs(node, childNodes, graph, portGlyphMap, genes);
            }
        }
    }

    private void traverseAndAddEdges(List<Arc> edges, CytoscapeJsGraph graph, Map<String, Glyph> portGlyphMap)
    {
        for (Arc arc : edges)
        {
            CytoscapeJsEdge edge = new CytoscapeJsEdge();

            String srcName = "", targetName = "";

            if(arc.getSource() instanceof Port)
            {
                srcName = ((Port)arc.getSource()).getId();
                targetName = ((Port)arc.getTarget()).getId();
            }
            else if(arc.getSource() instanceof Glyph)
            {
                srcName = ((Glyph)arc.getSource()).getId();
                targetName = ((Glyph)arc.getTarget()).getId();
            }


            if (portGlyphMap.get(srcName) != null) {
                srcName = portGlyphMap.get(srcName).getId();
            }

            if (portGlyphMap.get(targetName) != null) {
                targetName = portGlyphMap.get(targetName).getId();
            }

            edge.setProperty(PropertyKey.SOURCE, srcName);
            edge.setProperty(PropertyKey.TARGET, targetName);
            edge.setProperty(PropertyKey.ID, arc.getId());
            edge.setProperty(PropertyKey.SBGNCLASS, arc.getClazz());

            graph.getEdges().add(edge);
        }
    }

    public CytoscapeJsGraph toSBGNCompoundGraph(Model model, Collection<String> genes)
    {
        CytoscapeJsGraph graph = new CytoscapeJsGraph();

        Set<String> blacklist = getBlackListService().getBlackListSet();

        L3ToSBGNPDConverter sbgnConverter = new L3ToSBGNPDConverter(
                new ListUbiqueDetector(blacklist), null, true);

        Sbgn sbgn = sbgnConverter.createSBGN(model);

        List<Glyph> nodes = sbgn.getMap().getGlyph();
        List<Arc> edges = sbgn.getMap().getArc();

        Map<String, Glyph> portGlyphMap = new HashMap<String, Glyph>();

        traverseAndAddGlyphs(null, nodes, graph, portGlyphMap, genes);
        traverseAndAddEdges(edges, graph, portGlyphMap);

        return graph;
    }
}