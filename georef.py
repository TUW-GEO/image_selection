#  ***************************************************************************
#  *                                                                         *
#  *   This program is free software; you can redistribute it and/or modify  *
#  *   it under the terms of the GNU General Public License as published by  *
#  *   the Free Software Foundation; either version 2 of the License, or     *
#  *   (at your option) any later version.                                   *
#  *                                                                         *
#  ***************************************************************************

"""
/***************************************************************************
 SelORecon
                                 A QGIS plugin
 Guided selection and orientation of aerial reconnaissance images.
                              -------------------
        copyright            : (C) 2021 by Photogrammetry @ GEO, TU Wien, Austria
        email                : wilfried.karel@geo.tuwien.ac.at
 ***************************************************************************/
"""

import logging
import math
from pathlib import Path
import threading
import time
from typing import Any, cast, Final

import numpy as np
from osgeo import gdal

from qgis.PyQt.QtCore import QCoreApplication

from . import Config

logger: Final = logging.getLogger(__name__)
_matcher: Any = None

def _loadMatcher():
    global _matcher
    global cv2
    global torch
    global ToTensor
    # This is executed during import. Wait a little, until the log handlers are setup, such that exceptions during import end up in the log file.
    time.sleep(.5)
    try:
        import io
        import sys
        import urllib.request
        import cv2
        from se2_loftr import src
        from se2_loftr.src.loftr import LoFTR
        from se2_loftr.configs.loftr.outdoor import loftr_ds_e2
        import torch
        from torchvision.transforms import ToTensor
        from yacs.config import CfgNode as CN

        def lower_config(yacs_cfg):
            if not isinstance(yacs_cfg, CN):
                return yacs_cfg
            return {k.lower(): lower_config(v) for k, v in yacs_cfg.items()}

        assert torch.cuda.is_available()
        # If the QGIS Python console is not open, then sys.stderr is None,
        # and cpuMatcher.load_state_dict fails when importing pretty_errors.__init__:
        #     terminal_is_interactive = sys.stderr.isatty()
        # QGIS 3.34.6\apps\qgis-ltr\python\console\console_output.py
        # sets sys.stderr to its own implementation, independent if sys.stderr is None, or not.
        stderrWasNone = sys.stderr is None
        if stderrWasNone:
            sys.stderr = io.StringIO()
        torch.set_default_tensor_type(torch.cuda.FloatTensor)
        cpuMatcher = LoFTR(config=lower_config(loftr_ds_e2.cfg.LOFTR))
        weightsFn = Path(__file__).parent / 'se2-loftr-4rot.ckpt'
        if not weightsFn.exists():
            logger.info('Downloading weights.')
            with (urllib.request.urlopen('https://cloud.geo.tuwien.ac.at/s/ezo6dj9rd2wXxQm/download') as fin,
                  weightsFn.open('wb') as fout):
                fout.write(fin.read())
        cpuMatcher.load_state_dict(torch.load(weightsFn)['state_dict'])
        _matcher = cpuMatcher.eval().cuda()
        if stderrWasNone:
            val = cast(io.StringIO, sys.stderr).getvalue()
            if val:
                logger.warning(f'Something has been printed to stderr while loading the matcher:\n{val}')
    except:
        logger.exception('Failed to load the matcher. Automatic georeferencing unavailable!')
    else:
        logger.info('Matcher ready for automatic georeferencing.')

# If the main thread is idle for some time, async loading will have finished before the matcher is needed, despite the GIL.
_loadMatcherThread = threading.Thread(target=_loadMatcher)
_loadMatcherThread.start()

_orthoFn = f'''
    <GDAL_WMTS>
        <GetCapabilitiesUrl>https://maps.wien.gv.at/basemap/1.0.0/WMTSCapabilities.xml</GetCapabilitiesUrl>
        <Layer>bmaporthofoto30cm</Layer>
        <Cache><Path>{Config.gdalCachePath.value}</Path></Cache>
        <Timeout>{Config.httpTimeoutSeconds.value}</Timeout>
    </GDAL_WMTS>'''
_dsOrtho = gdal.Open(_orthoFn.strip())

def georef(dsAerial: gdal.Dataset, px2prjAerial: np.ndarray):
    while _loadMatcherThread.is_alive():
        logger.info('Waiting for the matcher to load.')
        QCoreApplication.processEvents()  # Forward the Qt signal to StatusBarLogHandler
        _loadMatcherThread.join(5.)  # timeout of StatusBarLogHandler. Use the same to display the message in the status bar until the matcher is loaded.
    if _matcher is None:
        raise Exception('Automatic georeferencing unavailable!')
    
    device = torch.device('cuda:0')
    toTens = ToTensor()
    
    def toTensor(arr):
        return toTens(arr.astype(np.uint8))[None].to(device)

    def geotransform(ds: gdal.Dataset):
        return np.array(ds.GetGeoTransform()).reshape((2, 3))
    
    startTime = time.time()

    assert px2prjAerial.shape == (2, 3)
    matchResolutionPx = 1000
    aerialSquareSize = min(dsAerial.RasterXSize, dsAerial.RasterYSize)
    aerial = dsAerial.ReadAsArray(
        xsize=aerialSquareSize,
        ysize=aerialSquareSize,
        buf_xsize=matchResolutionPx,
        buf_ysize=matchResolutionPx,
        buf_type=gdal.GDT_Byte,
        resample_alg=gdal.GRIORA_Gauss,
        # Aerials typically have a single band only, but some have 3 (RGB), e.g. Projekte LBDB\Image_Selection_Projektbeispiel\Images\15SG-1185\
        band_list=[1])
    #cv2.imwrite(r'D:\19_DoRIAH\ImageSelection_dev\aerialGdal.png', aerial)
    
    orthoWarped = np.zeros((matchResolutionPx, matchResolutionPx, 3), np.uint8)
    dsOrthoWarped = gdal.Open(_memDataset(orthoWarped), gdal.GA_Update)
    px2prjAerialMatchRes = px2prjAerial.copy()
    px2prjAerialMatchRes[:, 1:] *= aerialSquareSize / matchResolutionPx
    dsOrthoWarped.SetGeoTransform(tuple(px2prjAerialMatchRes.flat))
    dsOrthoWarped.SetSpatialRef(_dsOrtho.GetSpatialRef())
    # Timings for matching an image the second time, when image content is already in the GDAL cache, each time starting from the same ori.
    # Matching-only time is always  0.7s.
    # Timings for ReprojectImage with _maxZoomLevel = 18. ReprojectImage always reads the maximum resolution level, independent of the output GSD:
    # Image_Selection_Projektbeispiel\Images\15SG-1185\4126.ecw
    # GRA_NearestNeighbour:  43 inliers. Total time: 1.2s.
    # GRA_Bilinear:          27 inliers. Total time: 1.6s.
    # GRA_Average:           24 inliers. Total time: 2.3s.
    # Image_Selection_Projektbeispiel\Images\15SG-1045\4040.ecw
    # GRA_NearestNeighbour: 182 inliers. Total time: 1.0s.
    # GRA_Bilinear:         152 inliers. Total time: 1.3s.
    # GRA_Average:          150 inliers. Total time: 1.8s.
    # Image_Selection_Projektbeispiel\Images\15SG-1345\4090.ecw
    # GRA_NearestNeighbour:  87 inliers. Total time: 0.9s.
    # GRA_Bilinear:          87 inliers. Total time: 1.0s.
    # GRA_Average:           80 inliers. Total time: 1.4s.
    #gdal.ReprojectImage(_dsOrtho, dsOrthoWarped, eResampleAlg=gdal.GRA_NearestNeighbour)
    # Timings for Warp, which automatically selects an appropriate overview level:
    # Image_Selection_Projektbeispiel\Images\15SG-1185\4126.ecw
    # GRA_NearestNeighbour:  43 inliers. Total time: 0.8s.
    # GRA_Bilinear:          53 inliers. Total time: 0.9s.
    # GRA_Average:           49 inliers. Total time: 0.9s.
    # Image_Selection_Projektbeispiel\Images\15SG-1045\4040.ecw
    # GRA_NearestNeighbour: 112 inliers. Total time: 0.8s.
    # GRA_Bilinear:         133 inliers. Total time: 0.9s.
    # GRA_Average:          138 inliers. Total time: 0.7s.
    # Image_Selection_Projektbeispiel\Images\15SG-1345\4090.ecw
    # GRA_NearestNeighbour: 156 inliers. Total time: 0.8s.
    # GRA_Bilinear:         175 inliers. Total time: 0.9s.
    # GRA_Average:          157 inliers. Total time: 0.9s.
    gdal.Warp(dsOrthoWarped, _dsOrtho, resampleAlg=gdal.GRA_Bilinear, srcBands=[1, 2, 3])
    #cv2.imwrite(r'D:\19_DoRIAH\ImageSelection_dev\orthoWarped.jpg', cv2.cvtColor(orthoWarped, cv2.COLOR_RGB2BGR))

    startMatching = time.time()
    def match():
        with torch.no_grad():
            batch = {'image0': toTensor(aerial), 'image1': toTensor(orthoWarped @ [0.299, 0.587, 0.114])}
            _matcher(batch)
            aerialPts = batch['mkpts0_f'].cpu().numpy()
            orthoPts = batch['mkpts1_f'].cpu().numpy()
        return aerialPts, orthoPts
    aerialPts, orthoPts = match()
    matchingTook = time.time() - startMatching
    assert aerialPts.shape == orthoPts.shape
    if aerialPts.shape[0] < 2:
        raise Exception(f'Automatic georeferencing failed: only {aerialPts.shape[0]} matches.')

    # 50m maximum horiz. displacement due to perspective and terrain undulations.
    thresh_m = 50
    orthoWarpedGsd_m = abs(np.linalg.det(geotransform(dsOrthoWarped)[:, 1:])) ** .5
    thresh_px = thresh_m / orthoWarpedGsd_m
    maxIters = _maxNumItersRANSAC(nModelPoints=4, inlierRatio=.1, confidence=.99)
    H, inliers = cv2.estimateAffinePartial2D(orthoPts, to=aerialPts, method=cv2.RANSAC, ransacReprojThreshold=thresh_px, maxIters=maxIters)
    inliers = inliers.astype(bool).squeeze()
    orthoPts = (H[:, :2] @ orthoPts.T).T + H[:, 2]
    if 0:
        aerialBGR = cv2.cvtColor(aerial, cv2.COLOR_GRAY2BGR)
        # Print inliers on top
        for sel, ptCol, lineCol in zip((~inliers, inliers), ((255, 0, 255), (0, 255, 0)), ((0, 0, 255), (255, 255, 0)), strict=True):
            aerPts = aerialPts[sel]
            ortPts = orthoPts[sel]
            for aerialPt, orthoPt in zip(aerPts, ortPts, strict=True):
                pt1 = tuple(int(el) for el in aerialPt)
                pt2 = tuple(int(el) for el in orthoPt)
                cv2.circle(aerialBGR, center=pt1, radius=2, color=ptCol, thickness=1, lineType=cv2.LINE_AA, shift=0)
                cv2.line(aerialBGR, pt1, pt2, color=lineCol, thickness=1, lineType=cv2.LINE_AA, shift=0)
        cv2.imwrite(rf'D:\19_DoRIAH\ImageSelection_dev\{Path(dsAerial.GetFileList()[0]).stem}.jpg', aerialBGR)
    scaleMatch2square = aerialSquareSize / matchResolutionPx
    aerialPts *= scaleMatch2square
    orthoPts *= scaleMatch2square
    gt = geotransform(dsOrthoWarped)
    # GDAL stores the offset in the left-most column, OpenCV in the right-most one.
    gt = np.roll(gt, shift=-1, axis=1)
    Tinv = np.linalg.inv(H[:, :2])
    Hinv = np.c_[Tinv, -Tinv @ H[:, 2]]
    gt = np.c_[gt[:, :2] @ Hinv[:, :2], gt[:, :2] @ Hinv[:, 2] + gt[:, 2]]
    gt = np.roll(gt, shift=1, axis=1)
    if 0:
        orthoWarped[:] = 0
        dsOrthoWarped.SetGeoTransform(tuple(gt.flat))
        gdal.Warp(dsOrthoWarped, _dsOrtho, resampleAlg=gdal.GRA_Average)
        cv2.imwrite(r'D:\19_DoRIAH\ImageSelection_dev\orthoWarped_final.jpg', cv2.cvtColor(orthoWarped, cv2.COLOR_RGB2BGR))
    gt[:, 1:] *= 1. / scaleMatch2square
    logger.debug(f'Total time: {time.time() - startTime:.1f}s. Matching time: {matchingTook:.1f}s. Inlier ratio: {inliers.sum() / len(inliers):.2%}')
    return gt, aerialPts[inliers], orthoPts[inliers]


def _memDataset(img: np.ndarray) -> str:
    tmpl = 'MEM:::DATAPOINTER={},PIXELS={},LINES={},BANDS={},DATATYPE={},PIXELOFFSET={},LINEOFFSET={},BANDOFFSET={}'
    return tmpl.format(
        img.ctypes.data,
        img.shape[1],
        img.shape[0],
        1 if img.ndim == 2 else img.shape[2],
        _dtype2gdalTypeName[img.dtype],
        img.strides[1],
        img.strides[0],
        1 if img.ndim == 2 else img.strides[2])


_dtype2gdalTypeName = {
    np.dtype(np.uint8)  : 'Byte',
    np.dtype(np.uint16) : 'UInt16',
    np.dtype(np.int16)  : 'Int16',
    np.dtype(np.uint32) : 'UInt32',
    np.dtype(np.int32)  : 'Int32',
    np.dtype(np.float32): 'Float32',
    np.dtype(np.float64): 'Float64'
}

def _maxNumItersRANSAC(nModelPoints: int, inlierRatio: float, confidence: float) -> int:
    b = inlierRatio ** nModelPoints
    k = math.log(1. - confidence) / math.log(1. - b)
    return int(math.ceil(k))